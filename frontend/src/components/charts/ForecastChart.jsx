import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { browserTimezoneLabel } from '../../utils/dateTime';

const fmt = (v) => {
  if (!Number.isFinite(v)) return '$0';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  return `$${v.toFixed(0)}`;
};
const COLOMBO_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Colombo',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-hover)',
      borderRadius: 8, padding: '10px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      minWidth: 180,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
        {label ? `${COLOMBO_FORMATTER.format(new Date(label))} (Asia/Colombo)` : ''}
      </div>
      {payload.map((p) => (
        <div key={p.name} style={{ fontSize: 13, fontWeight: 600, color: p.color, marginBottom: 2 }}>
          {p.name === 'predicted' ? 'Predicted' : 'Actual'}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
};

/**
 * ForecastChart
 * Props:
 *   hourlyData   — array of hourly_metrics (actual values)
 *   predictions  — array of prediction documents
 */
export default function ForecastChart({ hourlyData = [], predictions = [] }) {
  const newestHourly = hourlyData
    .map((d) => new Date(d.hour_start))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a)[0];
  const now = newestHourly || new Date();
  const nowHour = new Date(now);
  nowHour.setUTCMinutes(0, 0, 0);

  // Build one full-ISO UTC timeline so dates and hours cannot collide.
  const actualMap = {};
  hourlyData.forEach((d) => {
    if (!d.hour_start) return;
    const hour = new Date(d.hour_start);
    if (Number.isNaN(hour.getTime())) return;
    if (hour.getTime() > now.getTime()) {
      console.warn('[PulseBI] Ignoring future-dated actual hour_start:', d.hour_start);
      return;
    }
    actualMap[hour.toISOString()] = d.total_cost || 0;
  });

  const predMap = {};
  predictions.forEach((p) => {
    const rawTarget = p.target_hour
      || (p.based_on_latest_hour
        ? new Date(new Date(p.based_on_latest_hour).getTime() + 60 * 60 * 1000)
        : p.prediction_time);
    if (!rawTarget) return;
    const target = new Date(rawTarget);
    if (Number.isNaN(target.getTime())) return;
    target.setUTCMinutes(0, 0, 0);
    if (target.getTime() >= nowHour.getTime()) {
      predMap[target.toISOString()] = p.predicted_total_cost_next_hour || 0;
    }
  });

  const allKeys = Array.from(new Set([
    ...Object.keys(actualMap),
    ...Object.keys(predMap),
  ])).sort();
  const windowStart = new Date(nowHour.getTime() - 23 * 60 * 60 * 1000);
  const last24Keys = allKeys.filter((time) => {
    const value = new Date(time);
    return value >= windowStart && value <= nowHour;
  });
  const chartData = last24Keys.map((time) => ({
    time,
    actual:    actualMap[time]    ?? null,
    predicted: predMap[time]      ?? null,
  }));

  if (!chartData.length) return (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      No data in this window
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="time"
          tickFormatter={(value) =>
            COLOMBO_FORMATTER.format(new Date(value))
          }
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={fmt}
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          verticalAlign="bottom"
          height={24}
          formatter={(value) => value === 'actual' ? 'Actual' : 'Predicted'}
        />
        <ReferenceLine
          x={nowHour.toISOString()}
          stroke="var(--danger)"
          strokeDasharray="4 4"
          label={{ value: 'Now', fill: 'var(--danger)', fontSize: 11, position: 'insideTopRight' }}
        />
        <Area
          type="monotone"
          dataKey="predicted"
          fill="url(#predGrad)"
          stroke="#6366f1"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          connectNulls
          animationDuration={600}
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="#22d3ee"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
          connectNulls
          animationDuration={600}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
