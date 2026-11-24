import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { fetchPredictions, fetchLatestPrediction, fetchPredictionEvaluation } from '../services/api';
import wsService from '../services/websocket';
import { formatMoney } from '../utils/format';
import { browserTimezoneLabel, formatBrowserDateTime, formatBrowserHour } from '../utils/dateTime';

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8, padding: '10px 14px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

const METRIC_KEYS = ['mae', 'rmse', 'mape'];

const formatMetric = (key, value) => {
  if (value == null) return '—';
  if (key === 'mape') return `${Number(value).toFixed(2)}%`;
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

// Match predictions with their evaluated actuals by source + target hour.
// Compare timestamps as numbers: "…:00Z" and "…:00.000Z" are the same hour.
const evalKey = (source, target) => `${source}|${new Date(target).getTime()}`;

function EvaluationCard({ title, model, baseline, mean24, label, note }) {
  return (
    <div className="evaluation-card">
      <div className="evaluation-card-title">{title}</div>
      {METRIC_KEYS.map((key) => (
        <div
          className="evaluation-values"
          key={key}
          style={{ marginBottom: 8, gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{key.toUpperCase()} - Model</div>
            <strong>{formatMetric(key, model?.[key])}</strong>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{key.toUpperCase()} - Naive</div>
            <strong>{formatMetric(key, baseline?.[key])}</strong>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{key.toUpperCase()} - Mean 24h</div>
            <strong>{formatMetric(key, mean24?.[key])}</strong>
          </div>
        </div>
      ))}
      <div className="evaluation-source">{label}</div>
      {note && <div className="evaluation-source" style={{ marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export default function Predictions() {
  const [predictions, setPredictions] = useState([]);
  const [latest, setLatest]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [apiError, setApiError]       = useState(false);
  const [evaluation, setEvaluation]   = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [predsRes, latestRes, evalRes] = await Promise.all([
          fetchPredictions(20),
          fetchLatestPrediction(),
          fetchPredictionEvaluation(200),
        ]);
        const preds = predsRes.predictions || [];
        setPredictions(preds);
        setLatest(latestRes.prediction ?? preds[0] ?? null);
        setEvaluation(evalRes);
        setApiError(false);
      } catch {
        // Keep the last data we had instead of showing generated numbers.
        setApiError(true);
      } finally {
        setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  // Live prediction events (listener is removed on unmount).
  useEffect(() => {
    const onPred = (data) => {
      setPredictions((prev) => [
        data,
        ...prev.filter((p) => !(p.target_hour === data.target_hour && p.source === data.source)),
      ].slice(0, 20));
      setLatest(data);
    };
    wsService.on('new_prediction', onPred);
    return () => wsService.off('new_prediction', onPred);
  }, []);

  const chartData = predictions
    .slice()
    .sort((a, b) => new Date(a.prediction_time) - new Date(b.prediction_time))
    .map((p) => ({
      time: p.prediction_time,
      cost: p.predicted_total_cost_next_hour || 0,
    }));

  const evaluatedMap = new Map();
  ['backtest', 'stream'].forEach((source) => {
    (evaluation?.[source]?.evaluated || []).forEach((item) => {
      evaluatedMap.set(evalKey(source, item.target_hour), item);
    });
  });

  const offline = evaluation?.offline_test;
  const excluded = offline?.excluded_hours_count;

  if (loading) return (
    <div className="page-content">
      <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>
        Loading predictions…
      </div>
    </div>
  );

  return (
    <div className="page-content">
      {apiError && (
        <div
          role="alert"
          style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8,
            border: '1px solid var(--warning)', color: 'var(--warning)', fontSize: 13,
          }}
        >
          Cannot reach the PulseBI API. Showing the last data received; retrying every 15 seconds.
        </div>
      )}

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
        <>
          <div className="evaluation-grid">
            <EvaluationCard
              title="Offline test"
              model={offline?.metrics?.model}
              baseline={offline?.metrics?.naive_baseline}
              mean24={offline?.metrics?.mean_24h}
              label={`n=${offline?.test_size ?? 0}, ${(offline?.test_size ?? 0) < 20 ? 'too few to conclude' : 'time-ordered test split'}`}
            />
            <EvaluationCard
              title="Backtest"
              model={evaluation.backtest?.model}
              baseline={evaluation.backtest?.naive_baseline}
              mean24={evaluation.backtest?.mean_24h}
              label={evaluation.backtest?.label || 'n=0, too few to conclude'}
              note="walk-forward, re-fit before each hour"
            />
            <EvaluationCard
              title="Stream"
              model={evaluation.stream?.model}
              baseline={evaluation.stream?.naive_baseline}
              mean24={evaluation.stream?.mean_24h}
              label={evaluation.stream?.label || 'n=0, too few to conclude'}
              note={evaluation.stream?.skipped_incomplete
                ? `${evaluation.stream.skipped_incomplete} skipped (hour incomplete)` : null}
            />
          </div>
          <div className="chart-subtitle" style={{ marginBottom: 24 }}>
            Only complete hours are used (at least 95% of the expected events).
            {excluded != null && ` ${excluded} incomplete hour${excluded === 1 ? '' : 's'} excluded from training and testing.`}
            {' '}Errors are in USD. Lower is better.
          </div>
        </>
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
                {formatMoney(latest.predicted_total_cost_next_hour || 0)}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
                Predicted revenue for {latest.target_hour
                  ? `the hour starting ${formatBrowserHour(latest.target_hour)}`
                  : 'the next hour'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                Generated at ({browserTimezoneLabel()})
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                {latest.prediction_time ? formatBrowserDateTime(latest.prediction_time) : '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Based on {latest.records_used ?? '?'} complete hours
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
                <span className="badge badge-info" style={{ marginLeft: 6 }}>{latest.source ?? 'stream'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prediction trend chart */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div className="chart-title">Prediction History</div>
        <div className="chart-subtitle" title="Revenue = total product cost (USD)">Predicted next-hour revenue over time</div>
        {chartData.length === 0 ? (
          <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            No predictions yet
          </div>
        ) : (
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
                tickFormatter={(v) => formatMoney(v, { axis: true })}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false} axisLine={false} width={56}
              />
              <Tooltip
                formatter={(v) => [formatMoney(v), 'Predicted Revenue']}
                labelFormatter={(value) => formatBrowserDateTime(value)}
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
        )}
      </div>

      {/* Predictions table */}
      <div className="chart-card">
        <div className="chart-title" style={{ marginBottom: 16 }}>Prediction Log</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Predicted Revenue</th>
                <th>For Hour ({browserTimezoneLabel()})</th>
                <th>Generated At ({browserTimezoneLabel()})</th>
                <th>Source</th>
                <th>Model</th>
                <th>Status</th>
                <th>Actual Revenue</th>
                <th>Error (%)</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p, idx) => {
                const source = p.source || 'stream';
                let target = p.target_hour;
                if (!target && p.based_on_latest_hour) {
                  target = new Date(new Date(p.based_on_latest_hour).getTime() + 60 * 60 * 1000);
                }
                const result = target ? evaluatedMap.get(evalKey(source, target)) : null;
                const error = result && result.actual_revenue
                  ? (Math.abs(result.model_predicted - result.actual_revenue) / result.actual_revenue) * 100
                  : null;
                return (
                  <tr key={`${source}-${p.target_hour || idx}`}>
                    <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                    <td style={{ color: 'var(--primary-light)', fontWeight: 700, fontSize: 15 }}>
                      {formatMoney(p.predicted_total_cost_next_hour || 0)}
                    </td>
                    <td style={{ fontSize: 12 }}>{target ? formatBrowserHour(target) : '—'}</td>
                    <td>{formatBrowserDateTime(p.prediction_time)}</td>
                    <td><span className="badge badge-info">{source}</span></td>
                    <td><span className="badge badge-info">{p.model_version ?? 'xgboost_v1'}</span></td>
                    <td>
                      <span className={`badge ${p.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>
                        {p.status ?? '—'}
                      </span>
                    </td>
                    <td>{result ? formatMoney(result.actual_revenue) : 'pending'}</td>
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
