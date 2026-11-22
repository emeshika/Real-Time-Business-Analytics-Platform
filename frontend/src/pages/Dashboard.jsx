import { useState, useEffect, useCallback, useRef } from 'react';
import KpiCard from '../components/kpi/KpiCard';
import RevenueLineChart from '../components/charts/RevenueLineChart';
import ShipmentBarChart from '../components/charts/ShipmentBarChart';
import WarehouseDonut from '../components/charts/WarehouseDonut';
import ForecastChart from '../components/charts/ForecastChart';
import { fetchHourlyMetrics, fetchHistoricalData, fetchPredictions } from '../services/api';
import { computeKPIs } from '../services/dummyData';
import wsService from '../services/websocket';
import { browserTimezoneLabel, formatBrowserDateTime } from '../utils/dateTime';

const fmt = (n) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000     ? `$${(n / 1_000).toFixed(1)}K` :
                   `$${n?.toFixed(2) ?? '0.00'}`;

const POLL_INTERVAL = 10_000; // refresh REST data every 10s
const MAX_ROWS = 25;

const eventTime = (tx) => tx.event_time || tx.timestamp;
const rowKey = (tx) => `${tx.id}-${eventTime(tx)}`;
const byNewest = (a, b) => new Date(eventTime(b)) - new Date(eventTime(a));
const isStreamRow = (tx) => tx.source === 'stream' && tx.id >= 1 && tx.id <= 10999;

export default function Dashboard({ wsStatus, pushAlert }) {
  // ── State ───────────────────────────────────────────────────
  const [hourlyData, setHourlyData]       = useState([]);
  const [transactions, setTransactions]   = useState([]);
  const [predictions, setPredictions]     = useState([]);
  const [kpis, setKpis]                   = useState({ totalRevenue: 0, totalOrders: 0, avgRating: 0, onTimeRate: 0 });
  const [prevKpis, setPrevKpis]           = useState(null);
  const [loading, setLoading]             = useState(true);
  const [apiError, setApiError]           = useState(false);
  const [newRowIds, setNewRowIds]         = useState(new Set());
  const prevPredCost = useRef(null);

  // Keep the latest pushAlert in a ref so the WebSocket listeners are
  // registered once and never re-subscribed when the prop identity changes.
  const pushAlertRef = useRef(pushAlert);
  useEffect(() => {
    pushAlertRef.current = pushAlert;
  }, [pushAlert]);

  // ── Load data (REST) ────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [hourlyRes, txRes, predRes] = await Promise.all([
        fetchHourlyMetrics(48),
        fetchHistoricalData(MAX_ROWS, 'stream'),
        fetchPredictions(10),
      ]);

      const h = hourlyRes.data?.length ? hourlyRes.data : [];

      // De-duplicate by id + event time, keep only real stream rows
      const seen = new Set();
      const t = (txRes.data?.length ? txRes.data : [])
        .filter(isStreamRow)
        .filter((tx) => {
          const key = rowKey(tx);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort(byNewest);

      const p = predRes.predictions?.length ? predRes.predictions : [];

      // 24h window ending at the newest hourly document, plus the 24h before it
      const sortedHours = [...h].sort(
        (a, b) => new Date(b.hour_start) - new Date(a.hour_start),
      );
      const newestHour = sortedHours[0] ? new Date(sortedHours[0].hour_start) : null;
      const windowStart = newestHour
        ? new Date(newestHour.getTime() - 23 * 60 * 60 * 1000)
        : null;
      const currentWindow = windowStart
        ? sortedHours
            .filter((d) => {
              const hour = new Date(d.hour_start);
              return hour >= windowStart && hour <= newestHour;
            })
            .sort((a, b) => new Date(a.hour_start) - new Date(b.hour_start))
        : [];
      const previousEnd = windowStart;
      const previousStart = previousEnd
        ? new Date(previousEnd.getTime() - 24 * 60 * 60 * 1000)
        : null;
      const previousWindow = previousStart
        ? sortedHours
            .filter((d) => {
              const hour = new Date(d.hour_start);
              return hour >= previousStart && hour < previousEnd;
            })
            .sort((a, b) => new Date(a.hour_start) - new Date(b.hour_start))
        : [];

      setPrevKpis(previousWindow.length ? computeKPIs(previousWindow) : null);
      setHourlyData(currentWindow);
      setTransactions(t);
      setPredictions(p);
      setKpis(computeKPIs(currentWindow));
      setApiError(false);
    } catch {
      // Keep whatever was last loaded and tell the user, instead of
      // replacing real data with generated sample numbers.
      setApiError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [loadData]);

  // ── WebSocket live updates ──────────────────────────────────
  useEffect(() => {
    const onTx = (data) => {
      if (!isStreamRow(data)) return;

      // Insert, replacing any row with the same id + event time
      setTransactions((prev) => {
        const key = rowKey(data);
        const rest = prev.filter((tx) => rowKey(tx) !== key);
        return [data, ...rest].sort(byNewest).slice(0, MAX_ROWS);
      });

      // Briefly highlight the new row
      const rowId = data.id ?? Date.now();
      setNewRowIds((prev) => new Set(prev).add(rowId));
      setTimeout(() => {
        setNewRowIds((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });
      }, 1200);

      // Lightweight incremental KPI update (the next REST poll corrects it)
      setKpis((prev) => ({
        ...prev,
        totalOrders: prev.totalOrders + 1,
        totalRevenue: prev.totalRevenue + (data.cost_of_product || 0),
      }));
    };

    const onPred = (data) => {
      const cost = data.predicted_total_cost_next_hour || 0;
      setPredictions((prev) => [data, ...prev].slice(0, 10));

      // Prediction-spike rule: >25% change vs the previous prediction
      if (prevPredCost.current !== null) {
        const pct = ((cost - prevPredCost.current) / (prevPredCost.current || 1)) * 100;
        if (Math.abs(pct) > 25) {
          pushAlertRef.current?.({
            type: 'anomaly',
            title: `Prediction spike: ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
            message: `Predicted cost next hour: ${fmt(cost)}. Significant deviation detected.`,
          });
        } else {
          pushAlertRef.current?.({
            type: 'prediction',
            title: 'New ML Forecast Ready',
            message: `Predicted revenue next hour: ${fmt(cost)}`,
          });
        }
      }
      prevPredCost.current = cost;
    };

    wsService.on('new_transaction', onTx);
    wsService.on('new_prediction', onPred);
    return () => {
      wsService.off('new_transaction', onTx);
      wsService.off('new_prediction', onPred);
    };
  }, []);

  // ── KPI change helpers ──────────────────────────────────────
  const kpiChange = (curr, prev) => {
    if (prev === null || prev === undefined) {
      return { text: '—', dir: 'neutral' };
    }
    if (prev === 0) return { text: curr === 0 ? '0.0%' : '+100.0%', dir: curr >= 0 ? 'up' : 'down' };
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, dir: pct > 0 ? 'up' : 'down' };
  };

  const revChange = kpiChange(kpis.totalRevenue, prevKpis?.totalRevenue);
  const ordChange = kpiChange(kpis.totalOrders,  prevKpis?.totalOrders);
  const ratChange = kpiChange(kpis.avgRating,    prevKpis?.avgRating);
  const ottChange = kpiChange(kpis.onTimeRate,   prevKpis?.onTimeRate);

  if (loading) {
    return (
      <div className="page-content">
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="kpi-card">
              <div className="skeleton" style={{ height: 12, width: '40%', marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 36, width: '70%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 10, width: '50%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      {apiError && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--warning)',
            color: 'var(--warning)',
            fontSize: 13,
          }}
        >
          Cannot reach the PulseBI API. Showing the last data received; retrying every 10 seconds.
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────── */}
      <div className="kpi-grid">
        <KpiCard
          label="Total Revenue (24h)"
          value={fmt(kpis.totalRevenue)}
          change={revChange.text}
          changeDir={revChange.dir}
          accentColor="var(--primary)"
          iconBg="rgba(99,102,241,0.15)"
        />
        <KpiCard
          label="Total Orders (24h)"
          value={kpis.totalOrders.toLocaleString()}
          change={ordChange.text}
          changeDir={ordChange.dir}
          accentColor="var(--accent)"
          iconBg="rgba(34,211,238,0.15)"
        />
        <KpiCard
          label="Avg Customer Rating"
          value={kpis.avgRating.toFixed(2)}
          change={ratChange.text}
          changeDir={ratChange.dir}
          accentColor="var(--warning)"
          iconBg="rgba(245,158,11,0.15)"
        />
        <KpiCard
          label="On-Time Delivery"
          value={`${kpis.onTimeRate.toFixed(1)}%`}
          change={ottChange.text}
          changeDir={ottChange.dir}
          accentColor="var(--success)"
          iconBg="rgba(16,185,129,0.15)"
        />
      </div>

      {/* ── Main Charts Row ─────────────────────────────────── */}
      <div className="charts-grid">
        {/* Revenue trend */}
        <div className="chart-card">
          <div className="chart-title" title="Revenue = total product cost (USD)">Revenue Trend — Last 24 Hours</div>
          <div className="chart-subtitle">Hourly total product cost (USD) · times in {browserTimezoneLabel()}</div>
          <RevenueLineChart data={hourlyData} />
        </div>

        {/* Shipment breakdown */}
        <div className="chart-card">
          <div className="chart-title">Shipment Mode Breakdown</div>
          <div className="chart-subtitle">Orders by transport type</div>
          <ShipmentBarChart data={hourlyData} />
        </div>
      </div>

      {/* ── Second Row ──────────────────────────────────────── */}
      <div className="charts-grid">
        {/* ML Forecast */}
        <div className="chart-card">
          <div className="chart-title" title="Revenue = total product cost (USD)">Revenue Forecast</div>
          <div className="chart-subtitle">
            Actual / Predicted · times in {browserTimezoneLabel()}
          </div>
          <ForecastChart hourlyData={hourlyData} predictions={predictions} />
        </div>

        {/* Warehouse donut */}
        <div className="chart-card">
          <div className="chart-title">Warehouse Distribution</div>
          <div className="chart-subtitle">Orders by warehouse block (24h)</div>
          <WarehouseDonut data={hourlyData} />
        </div>
      </div>

      {/* ── Live Transactions Table ──────────────────────────── */}
      <div className="chart-card" style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="chart-title">Live Transactions</div>
            <div className="chart-subtitle">Most recent events from the data stream</div>
          </div>
          <span className="badge badge-info">{transactions.length} records</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Source</th>
                <th>Event Time ({browserTimezoneLabel()})</th>
                <th>Warehouse</th>
                <th>Shipment</th>
                <th>Product Cost</th>
                <th>Discount</th>
                <th>Rating</th>
                <th>On Time</th>
                <th>Weight (g)</th>
                <th>Importance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={rowKey(tx)} className={newRowIds.has(tx.id) ? 'new-row' : ''}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>#{tx.id}</td>
                  <td><span className="badge badge-cyan">{tx.source || 'stream'}</span></td>
                  <td>{formatBrowserDateTime(eventTime(tx))}</td>
                  <td>
                    <span className="badge badge-info">Block {tx.warehouse_block}</span>
                  </td>
                  <td>
                    <span className={
                      tx.mode_of_shipment === 'Ship'   ? 'badge badge-info' :
                      tx.mode_of_shipment === 'Flight' ? 'badge badge-cyan' :
                                                          'badge badge-success'
                    }>
                      {tx.mode_of_shipment}
                    </span>
                  </td>
                  <td style={{ color: 'var(--success)', fontWeight: 600 }}>
                    ${tx.cost_of_product?.toFixed(2) ?? '—'}
                  </td>
                  <td style={{ color: 'var(--warning)' }}>{tx.discount_offered?.toFixed(1)}%</td>
                  <td>{Number(tx.customer_rating || 0).toFixed(1)} / 5</td>
                  <td>
                    {tx.reached_on_time === 1
                      ? <span className="badge badge-success">Yes</span>
                      : <span className="badge badge-danger">No</span>}
                  </td>
                  <td>{tx.weight_in_gms?.toLocaleString()}</td>
                  <td>
                    <span className={
                      tx.product_importance === 'High'   ? 'badge badge-danger' :
                      tx.product_importance === 'Medium' ? 'badge badge-warning' :
                                                            'badge badge-info'
                    }>
                      {tx.product_importance}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <footer className="dashboard-footer">
        Simulated real-time stream replaying a public Kaggle e-commerce shipping dataset (10,999 rows).
        Historical hourly and daily data is backfilled from sampled CSV rows through the same aggregation pipeline.
      </footer>
    </div>
  );
}