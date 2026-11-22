import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchPredictions, fetchLatestPrediction, fetchPredictionEvaluation } from '../services/api';
import { generatePredictions } from '../services/dummyData';
import { browserTimezoneLabel, formatBrowserDateTime, formatBrowserHour } from '../utils/dateTime';

const fmt = (v) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` :
  v >= 1_000     ? `$${(v / 1_000).toFixed(1)}k` :
                   `$${v?.toFixed(2) ?? '0'}`;

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8, padding: '10px 14px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

export default function Predictions() {
  const [predictions, setPredictions] = useState([]);
  const [latest, setLatest]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [evaluation, setEvaluation]   = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [predsRes, latestRes, evalRes] = await Promise.all([
          fetchPredictions(20),
          fetchLatestPrediction(),
          fetchPredictionEvaluation(200),
        ]);
        const preds = predsRes.predictions?.length ? predsRes.predictions : generatePredictions(12);
        setPredictions(preds);
        setLatest(latestRes.prediction ?? preds[0] ?? null);
        setEvaluation(evalRes);
      } catch {
        const preds = generatePredictions(12);
        setPredictions(preds);
        setLatest(preds[0]);
      } finally { setLoading(false); }
    };
    load();

    // Also listen for live prediction events via WebSocket
    import('../services/websocket').then(({ default: wsService }) => {
      const onPred = (data) => {
        setPredictions((prev) => [data, ...prev].slice(0, 20));
        setLatest(data);
      };
      wsService.on('new_prediction', onPred);
      return () => wsService.off('new_prediction', onPred);
    });
  }, []);

  const chartData = predictions
    .slice().sort((a, b) => new Date(a.prediction_time) - new Date(b.prediction_time))
    .map((p) => ({
      time: p.prediction_time,
      cost: p.predicted_total_cost_next_hour || 0,
    }));

  const evaluatedMap = new Map(
    [
      ...(evaluation?.backtest?.evaluated || []),
      ...(evaluation?.stream?.evaluated || []),
    ].map((item) => [item.target_hour, item])
  );

  if (loading) return (
    <div className="page-content">
      <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>
        Loading predictions…
      </div>
    </div>
  );

  return (
    <div className="page-content">
      <div className="section-header" style={{ marginBottom: 24 }}>
        <div>
          <div className="section-title">ML Predictions</div>
          <div className="section-desc">XGBoost time-series revenue forecast</div>
        </div>
        <span className="badge badge-info" style={{ fontSize: 12, padding: '6px 14px' }}>
          Model: XGBoost v1
        </span>
      </div>

      {evaluation && (
        <div className="evaluation-grid">
          {[
            ['Offline test', evaluation.offline_test?.metrics?.model,
              evaluation.offline_test?.metrics?.naive_baseline,
              evaluation.offline_test?.metrics?.mean_24h,
              `n=${(evaluation.offline_test?.test_size ?? 0)}, ${(evaluation.offline_test?.test_size ?? 0) < 20 ? 'too few to conclude' : 'test-set metrics'}`],
            ['Backtest', evaluation.backtest?.model, evaluation.backtest?.naive_baseline,
              evaluation.backtest?.mean_24h,
              evaluation.backtest?.label || 'n=0, too few to conclude'],
            ['Stream', evaluation.stream?.model, evaluation.stream?.naive_baseline,
              evaluation.stream?.mean_24h,
              evaluation.stream?.label || 'n=0, too few to conclude'],
          ].map(([title, model, baseline, mean24, label]) => (
            <div className="evaluation-card" key={title}>
              <div className="evaluation-card-title">{title}</div>
              {['mae', 'rmse', 'mape'].map((key) => (
                <div className="evaluation-values" key={key} style={{ marginBottom: 8, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {key.toUpperCase()} - Model
                    </div>
                    <strong>{model?.[key] == null ? '—' : key === 'mape'
                      ? `${Number(model[key]).toFixed(2)}%`
                      : `$${Number(model[key]).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {key.toUpperCase()} - Naive
                    </div>
                    <strong>{baseline?.[key] == null ? '—' : key === 'mape'
                      ? `${Number(baseline[key]).toFixed(2)}%`
                      : `$${Number(baseline[key]).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {key.toUpperCase()} - Mean 24h
                    </div>
                    <strong>{mean24?.[key] == null ? '—' : key === 'mape'
                      ? `${Number(mean24[key]).toFixed(2)}%`
                      : `$${Number(mean24[key]).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong>
                  </div>
                </div>
              ))}
              <div className="evaluation-source">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Latest prediction hero card */}
      {latest && (
        <div className="card" style={{
          marginBottom: 24,
          background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(34,211,238,0.08) 100%)',
          border: '1px solid rgba(99,102,241,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 4 }}>
                Latest Prediction
              </div>
              <div style={{ fontSize: 42, fontWeight: 800, color: 'var(--primary-light)', letterSpacing: '-0.03em' }}>
                {fmt(latest.predicted_total_cost_next_hour || 0)}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
                Predicted revenue for the next hour
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                Generated at ({browserTimezoneLabel()})
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                {latest.prediction_time
                  ? formatBrowserDateTime(latest.prediction_time)
                  : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Based on {latest.records_used ?? '?'} records
              </div>
              {latest.based_on_latest_hour && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Based on hour: {formatBrowserHour(latest.based_on_latest_hour)} ({browserTimezoneLabel()})
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <span className={`badge ${latest.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>
                  {latest.status ?? 'unknown'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prediction trend chart */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div className="chart-title">Prediction History</div>
        <div className="chart-subtitle" title="Revenue = total product cost (USD)">Predicted next-hour revenue over time</div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="predHistGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => formatBrowserDateTime(value)}
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false} axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false} axisLine={false} width={52}
            />
            <Tooltip
              formatter={(v) => [fmt(v), 'Predicted Revenue']}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--text-muted)' }}
            />
            <Area
              type="monotone" dataKey="cost"
              stroke="#6366f1" strokeWidth={2.5}
              fill="url(#predHistGrad)"
              dot={{ r: 4, fill: '#6366f1', stroke: 'var(--bg-card)', strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              animationDuration={600}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Predictions table */}
      <div className="chart-card">
        <div className="chart-title" style={{ marginBottom: 16 }}>Prediction Log</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Predicted Revenue (next hr)</th>
                <th>Generated At ({browserTimezoneLabel()})</th>
                <th>Based On Hour ({browserTimezoneLabel()})</th>
                <th>Records Used</th>
                <th>Model</th>
                <th>Status</th>
                <th>Actual Revenue</th>
                <th>Error (%)</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p, idx) => {
                let target = null;
                if (p.target_hour) {
                  target = new Date(p.target_hour);
                } else if (p.based_on_latest_hour) {
                  target = new Date(new Date(p.based_on_latest_hour).getTime() + 60 * 60 * 1000);
                } else if (p.prediction_time) {
                  target = new Date(new Date(p.prediction_time).getTime() + 60 * 60 * 1000);
                }
                if (target) target.setUTCMinutes(0, 0, 0);
                const result = target ? evaluatedMap.get(target.toISOString()) : null;
                const error = result && result.actual_revenue
                  ? Math.abs(result.model_predicted - result.actual_revenue) / result.actual_revenue * 100
                  : null;
                return (
                <tr key={idx}>
                  <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                  <td style={{ color: 'var(--primary-light)', fontWeight: 700, fontSize: 15 }}>
                    {fmt(p.predicted_total_cost_next_hour || 0)}
                  </td>
                  <td>{formatBrowserDateTime(p.prediction_time)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {formatBrowserHour(p.based_on_latest_hour)}
                  </td>
                  <td>{p.records_used ?? '—'}</td>
                  <td><span className="badge badge-info">{p.model_version ?? 'xgboost_v1'}</span></td>
                  <td>
                    <span className={`badge ${p.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>
                      {p.status ?? '—'}
                    </span>
                  </td>
                  <td>{result ? fmt(result.actual_revenue) : 'pending'}</td>
                  <td>{error == null ? 'pending' : `${error.toFixed(2)}%`}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
