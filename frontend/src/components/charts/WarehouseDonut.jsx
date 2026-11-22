import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const WAREHOUSE_COLORS = {
  A: '#6366f1',
  B: '#22d3ee',
  C: '#10b981',
  D: '#f59e0b',
  F: '#ef4444',
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: p } = payload[0];
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-hover)',
      borderRadius: 8, padding: '10px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: p.fill, marginBottom: 2 }}>
        Block {name}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
        {value} orders ({p.pct}%)
      </div>
    </div>
  );
};

const renderLegend = (props) => {
  const { payload } = props;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', justifyContent: 'center', marginTop: 8 }}>
      {payload.map((entry) => (
        <div key={entry.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: entry.color, display: 'inline-block' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Block {entry.value}</span>
        </div>
      ))}
    </div>
  );
};

/**
 * WarehouseDonut
 * Props: data — array of hourly_metrics
 */
export default function WarehouseDonut({ data = [] }) {
  // Aggregate warehouse block counts
  const totals = {};
  data.forEach((d) => {
    const wb = d.warehouse_block_counts || {};
    Object.entries(wb).forEach(([k, v]) => {
      if (!k || k === 'Unknown') return;
      totals[k] = (totals[k] || 0) + v;
    });
  });

  const total = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
  const chartData = Object.entries(totals).map(([name, value]) => ({
    name, value,
    pct: ((value / total) * 100).toFixed(1),
    fill: WAREHOUSE_COLORS[name] || '#94a3b8',
  }));

  if (!chartData.length) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      No data yet…
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          innerRadius={52}
          outerRadius={78}
          paddingAngle={3}
          dataKey="value"
          animationDuration={700}
          stroke="none"
        >
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} fillOpacity={0.9} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend content={renderLegend} />
      </PieChart>
    </ResponsiveContainer>
  );
}
