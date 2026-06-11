import { useState, useEffect, useCallback, useRef } from 'react';
import KpiCard from '../components/kpi/KpiCard';
import RevenueLineChart from '../components/charts/RevenueLineChart';
import ShipmentBarChart from '../components/charts/ShipmentBarChart';
import WarehouseDonut from '../components/charts/WarehouseDonut';
import ForecastChart from '../components/charts/ForecastChart';
import { fetchHourlyMetrics, fetchHistoricalData, fetchPredictions } from '../services/api';
import {
  generateHourlyMetrics,
  generateTransactions,
  generatePredictions,
  computeKPIs,
} from '../services/dummyData';

const fmt = (n) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000     ? `$${(n / 1_000).toFixed(1)}k` :
                   `$${n?.toFixed(2) ?? '0.00'}`;

const POLL_INTERVAL = 10_000; // refresh REST data every 10s

export default function Dashboard({ wsStatus, pushAlert }) {
  // ── State ───────────────────────────────────────────────────
  const [hourlyData, setHourlyData]       = useState([]);
  const [transactions, setTransactions]   = useState([]);
  const [predictions, setPredictions]     = useState([]);
  const [kpis, setKpis]                   = useState({ totalRevenue: 0, totalOrders: 0, avgRating: 0, onTimeRate: 0 });
  const [prevKpis, setPrevKpis]           = useState(null);
  const [loading, setLoading]             = useState(true);
  const [newRowIds, setNewRowIds]         = useState(new Set());
  const prevPredCost = useRef(null);

  // ── Load data (REST) ────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [hourlyRes, txRes, predRes] = await Promise.all([
        fetchHourlyMetrics(24),
        fetchHistoricalData(25),
        fetchPredictions(10),
      ]);
      const h = hourlyRes.data?.length ? hourlyRes.data : generateHourlyMetrics(24);
      const t = txRes.data?.length     ? txRes.data     : generateTransactions(20);
      const p = predRes.predictions?.length ? predRes.predictions : generatePredictions(8);
      setHourlyData(h);
      setTransactions(t);
      setPredictions(p);
      setPrevKpis(kpis);
      setKpis(computeKPIs(h));
    } catch {
      // Backend offline → use dummy data
      const h = generateHourlyMetrics(24);
      const t = generateTransactions(20);
      const p = generatePredictions(8);
      setHourlyData(h);
      setTransactions(t);
      setPredictions(p);
      setKpis(computeKPIs(h));
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
  // These are injected via App.jsx through wsLiveTx / wsLivePred props
  // but we also listen via the wsService singleton directly.
  useEffect(() => {
    import('../services/websocket').then(({ default: wsService }) => {
      const onTx = (data) => {
        setTransactions((prev) => [data, ...prev].slice(0, 25));
        setNewRowIds((prev) => {
          const next = new Set(prev);
          next.add(data.id ?? Date.now());
          setTimeout(() => setNewRowIds((s) => { const n2 = new Set(s); n2.delete(data.id ?? 0); return n2; }), 1200);
          return next;
        });
        // Re-compute KPIs incrementally (lightweight update)
        setKpis((prev) => ({
          ...prev,
          totalOrders: prev.totalOrders + 1,
          totalRevenue: prev.totalRevenue + (data.cost_of_product || 0),
        }));
      };

      const onPred = (data) => {
        const cost = data.predicted_total_cost_next_hour || 0;
        setPredictions((prev) => [data, ...prev].slice(0, 10));

        // Anomaly detection: >25% spike vs rolling avg
        if (prevPredCost.current !== null) {
          const pct = ((cost - prevPredCost.current) / (prevPredCost.current || 1)) * 100;
          if (Math.abs(pct) > 25) {
            pushAlert({
              type: 'anomaly',
              title: `Revenue Anomaly: ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
              message: `Predicted cost next hour: ${fmt(cost)}. Significant deviation detected.`,
            });
          } else {
            pushAlert({
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
    });
  }, [pushAlert]);

  // ── KPI change helpers ──────────────────────────────────────
  const kpiChange = (curr, prev, prefix = '$') => {
    if (!prev || prev === 0) return { text: '—', dir: 'neutral' };
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, dir: pct > 0 ? 'up' : 'down' };
  };

  const revChange   = kpiChange(kpis.totalRevenue, prevKpis?.totalRevenue);
  const ordChange   = kpiChange(kpis.totalOrders,  prevKpis?.totalOrders);
  const ratChange   = kpiChange(kpis.avgRating,    prevKpis?.avgRating);
  const ottChange   = kpiChange(kpis.onTimeRate,   prevKpis?.onTimeRate);

  if (loading) {
    return (
      <div className="page-content">
        <div className="kpi-grid">
          {[1,2,3,4].map((i) => (
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
      {/* ── KPI Cards ──────────────────────────────────────── */}
      <div className="kpi-grid">
        <KpiCard
          label="Total Revenue (24h)"
          value={fmt(kpis.totalRevenue)}
          change={revChange.text}
          changeDir={revChange.dir}
          icon="💰"
          accentColor="var(--primary)"
          iconBg="rgba(99,102,241,0.15)"
        />
        <KpiCard
          label="Total Orders (24h)"
          value={kpis.totalOrders.toLocaleString()}
          change={ordChange.text}
          changeDir={ordChange.dir}
          icon="📦"
          accentColor="var(--accent)"
          iconBg="rgba(34,211,238,0.15)"
        />
        <KpiCard
          label="Avg Customer Rating"
          value={`${kpis.avgRating.toFixed(2)} ⭐`}
          change={ratChange.text}
          changeDir={ratChange.dir}
          icon="⭐"
          accentColor="var(--warning)"
          iconBg="rgba(245,158,11,0.15)"
        />
        <KpiCard
          label="On-Time Delivery"
          value={`${kpis.onTimeRate.toFixed(1)}%`}
          change={ottChange.text}
          changeDir={ottChange.dir}
          icon="🚚"
          accentColor="var(--success)"
          iconBg="rgba(16,185,129,0.15)"
        />
      </div>

      {/* ── Main Charts Row ─────────────────────────────────── */}
      <div className="charts-grid">
        {/* Revenue trend */}
        <div className="chart-card">
          <div className="chart-title">Revenue Trend — Last 24 Hours</div>
          <div className="chart-subtitle">Hourly total product cost (USD)</div>
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
          <div className="chart-title">
            Revenue Forecast&nbsp;
            <span className="badge badge-info" style={{ fontSize: 10, verticalAlign: 'middle' }}>
              XGBoost v1
            </span>
          </div>
          <div className="chart-subtitle">
            <span style={{ color: '#22d3ee' }}>━</span> Actual &nbsp;
            <span style={{ color: '#6366f1' }}>╌</span> Predicted
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
              {transactions.map((tx, idx) => (
                <tr key={tx.id ?? idx} className={newRowIds.has(tx.id) ? 'new-row' : ''}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>#{tx.id}</td>
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
                  <td>{'⭐'.repeat(Math.min(tx.customer_rating || 0, 5))}</td>
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
    </div>
  );
}
