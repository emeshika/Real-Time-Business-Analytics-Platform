import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

const fmt = (v) =>
  v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v?.toFixed(0) ?? 0}`;

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
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ fontSize: 13, fontWeight: 600, color: p.color, marginBottom: 2 }}>
          {p.name === 'predicted' ? '🤖 Predicted' : '📊 Actual'}: {fmt(p.value)}
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
  // Build merged timeline
  const actualMap = {};
  hourlyData.forEach((d) => {
    const label = new Date(d.hour_start).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    actualMap[label] = d.total_cost || 0;
  });

  const predMap = {};
  predictions.forEach((p) => {
    const label = new Date(p.prediction_time).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    predMap[label] = p.predicted_total_cost_next_hour || 0;
  });

  const allKeys = Array.from(new Set([...Object.keys(actualMap), ...Object.keys(predMap)])).sort();

  const chartData = allKeys.slice(-16).map((time) => ({
    time,
    actual:    actualMap[time]    ?? null,
    predicted: predMap[time]      ?? null,
  }));

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
