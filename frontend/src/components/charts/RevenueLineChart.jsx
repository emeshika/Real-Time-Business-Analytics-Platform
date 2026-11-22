import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { browserTimezoneLabel, formatBrowserDateTime } from '../../utils/dateTime';

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
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        {COLOMBO_FORMATTER.format(new Date(label))} (Asia/Colombo)
      </div>
      {payload.map((p) => (
        <div key={p.name} style={{ fontSize: 13, fontWeight: 600, color: p.color }}>
          {p.name === 'total_cost' ? 'Revenue' : p.name}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
};

/**
 * RevenueLineChart
 * Props: data — array of hourly_metrics documents
 */
export default function RevenueLineChart({ data = [] }) {
  const validData = data
    .filter((d) => d?.hour_start && !Number.isNaN(new Date(d.hour_start).getTime()));
  const newestHour = validData
    .map((d) => new Date(d.hour_start))
    .sort((a, b) => b - a)[0];
  const cutoff = newestHour
    ? new Date(newestHour.getTime() - 23 * 60 * 60 * 1000)
    : null;
  const chartData = data
    .slice()
    .filter((d) => d?.hour_start
      && !Number.isNaN(new Date(d.hour_start).getTime())
      && (!cutoff || (new Date(d.hour_start) >= cutoff && new Date(d.hour_start) <= newestHour)))
    .sort((a, b) => new Date(a.hour_start) - new Date(b.hour_start))
    .map((d) => ({
      time: d.hour_start,
      total_cost: d.total_cost || 0,
      transactions: d.total_transactions || 0,
    }));

  if (!chartData.length) return (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      No data in this window
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="time"
          tickFormatter={(value) => COLOMBO_FORMATTER.format(new Date(value))}
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
          width={50}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="total_cost"
          stroke="#6366f1"
          strokeWidth={2.5}
          fill="url(#revGrad)"
          dot={false}
          activeDot={{ r: 5, fill: '#6366f1' }}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
