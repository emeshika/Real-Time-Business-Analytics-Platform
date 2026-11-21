import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import { fetchHourlyMetrics, fetchDailyMetrics } from '../services/api';
import { generateHourlyMetrics, generateDailyMetrics } from '../services/dummyData';

const fmt = (v) =>
  v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v?.toFixed(0) ?? 0}`;

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8, padding: '10px 14px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

export default function Analytics() {
  const [hourly, setHourly] = useState([]);
  const [daily, setDaily]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [hr, dr] = await Promise.all([fetchHourlyMetrics(24), fetchDailyMetrics(7)]);
        setHourly(hr.data?.length ? hr.data : generateHourlyMetrics(24));
        setDaily(dr.data?.length  ? dr.data  : generateDailyMetrics(7));
      } catch {
        setHourly(generateHourlyMetrics(24));
        setDaily(generateDailyMetrics(7));
      } finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const dailyChart = daily
    .slice().sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
    .map((d) => ({
      day: new Date(d.date_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      revenue: d.total_cost || 0,
      orders:  d.total_transactions || 0,
      rating:  d.avg_rating || 0,
      discount: d.avg_discount || 0,
      onTime:   ((d.on_time_rate || 0) * 100),
    }));

  const radarData = hourly.slice(-1)[0] ? [
    { metric: 'Revenue',     value: Math.min(((hourly.slice(-1)[0].total_cost || 0) / 10000) * 100, 100) },
    { metric: 'Orders',      value: Math.min(((hourly.slice(-1)[0].total_transactions || 0) / 60) * 100, 100) },
    { metric: 'Rating',      value: ((hourly.slice(-1)[0].avg_rating || 0) / 5) * 100 },
    { metric: 'On-Time',     value: (hourly.slice(-1)[0].on_time_rate || 0) * 100 },
    { metric: 'Discount',    value: Math.max(100 - (hourly.slice(-1)[0].avg_discount || 0), 0) },
  ] : [];

  if (loading) return (
    <div className="page-content">
      <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>Loading analytics…</div>
    </div>
  );

  return (
    <div className="page-content">
      <div className="section-header" style={{ marginBottom: 24 }}>
        <div>
          <div className="section-title">Business Analytics</div>
          <div className="section-desc">7-day historical performance deep-dive</div>
        </div>
      </div>

      {/* Daily Revenue vs Orders */}
      <div className="charts-grid" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: 24 }}>
        <div className="chart-card">
          <div className="chart-title" title="Revenue = total product cost (USD)">Daily Revenue (Last 7 Days)</div>
          <div className="chart-subtitle">Total product cost per day</div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={52} />
              <Tooltip formatter={(v) => [fmt(v), 'Revenue']}
                contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-muted)' }} />
              <Bar dataKey="revenue" fill="#6366f1" fillOpacity={0.85} radius={[6, 6, 0, 0]} maxBarSize={50} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* KPI Radar */}
        <div className="chart-card">
          <div className="chart-title">Operations Radar</div>
          <div className="chart-subtitle">Latest hour performance (0–100 scale)</div>
          <ResponsiveContainer width="100%" height={230}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Score" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trends: Rating & Discount & On-Time */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div className="chart-title">Customer & Operational Trends</div>
        <div className="chart-subtitle">Daily avg rating, discount %, and on-time delivery rate (%)</div>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-muted)' }} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 8 }}
            />
            <Line type="monotone" dataKey="rating"   name="Avg Rating"   stroke="#f59e0b" strokeWidth={2.5} dot={false} animationDuration={600} />
            <Line type="monotone" dataKey="onTime"   name="On-Time (%)"  stroke="#10b981" strokeWidth={2.5} dot={false} animationDuration={600} />
            <Line type="monotone" dataKey="discount" name="Avg Discount %" stroke="#ef4444" strokeWidth={2}  dot={false} strokeDasharray="5 3" animationDuration={600} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary table */}
      <div className="chart-card">
        <div className="chart-title" style={{ marginBottom: 16 }}>Daily Summary Table</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th><th>Revenue</th><th>Orders</th>
                <th>Avg Rating</th><th>On-Time %</th><th>Avg Discount</th>
              </tr>
            </thead>
            <tbody>
              {dailyChart.slice().reverse().map((d) => (
                <tr key={d.day}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.day}</td>
                  <td style={{ color: 'var(--success)', fontWeight: 600 }}>{fmt(d.revenue)}</td>
                  <td>{d.orders.toLocaleString()}</td>
                  <td>{d.rating.toFixed(2)} / 5</td>
                  <td>
                    <span className={d.onTime >= 70 ? 'badge badge-success' : 'badge badge-danger'}>
                      {d.onTime.toFixed(1)}%
                    </span>
                  </td>
                  <td>{d.discount.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
