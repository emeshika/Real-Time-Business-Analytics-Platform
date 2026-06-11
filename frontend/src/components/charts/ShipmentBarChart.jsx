import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';

const COLORS = {
  Ship:   '#6366f1',
  Flight: '#22d3ee',
  Road:   '#10b981',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-hover)',
      borderRadius: 8, padding: '10px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: COLORS[label] || '#6366f1', fontWeight: 600 }}>
        {payload[0].value} transactions
      </div>
    </div>
  );
};

/**
 * ShipmentBarChart
 * Props: data — array of hourly_metrics (aggregated) or a flat array
 *        { mode, count }
 */
export default function ShipmentBarChart({ data = [] }) {
  // Aggregate shipment counts across all hourly records
  const totals = { Ship: 0, Flight: 0, Road: 0 };
  data.forEach((d) => {
    const sm = d.shipment_mode_counts || {};
    Object.entries(sm).forEach(([k, v]) => {
      if (k in totals) totals[k] += v;
    });
    // Also support flat format
    if (d.mode) totals[d.mode] = (totals[d.mode] || 0) + (d.count || 0);
  });

  const chartData = Object.entries(totals).map(([mode, count]) => ({ mode, count }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="mode"
          tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={60} animationDuration={700}>
          {chartData.map((entry) => (
            <Cell key={entry.mode} fill={COLORS[entry.mode] || '#6366f1'} fillOpacity={0.9} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
