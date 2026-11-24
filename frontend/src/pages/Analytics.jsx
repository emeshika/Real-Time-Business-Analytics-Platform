import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import { fetchHourlyMetrics, fetchDailyMetrics } from '../services/api';
import {
  EVENTS_PER_HOUR, COMPLETE_HOUR_RATIO, formatMoney, isCompleteHour,
} from '../utils/format';

const TOOLTIP_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8, padding: '10px 14px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

const EVENTS_PER_DAY = EVENTS_PER_HOUR * 24;

export default function Analytics() {
  const [hourly, setHourly]   = useState([]);
  const [daily, setDaily]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [hr, dr] = await Promise.all([fetchHourlyMetrics(48), fetchDailyMetrics(7)]);
        setHourly(hr.data || []);
        setDaily(dr.data || []);
        setApiError(false);
      } catch {
        // Keep the last data we had instead of showing generated numbers.
        setApiError(true);
      } finally {
        setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  // Daily buckets are UTC days, so label them in UTC to avoid shifting the date.
  const dailyChart = daily
    .slice()
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
    .map((d) => ({
      day: new Date(d.date_start).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', timeZone: 'UTC',
      }),
      revenue: d.total_cost || 0,
      orders: d.total_transactions || 0,
      rating: d.avg_rating || 0,
      discount: d.avg_discount || 0,
      onTime: (d.on_time_rate || 0) * 100,
      inProgress: new Date(d.date_start).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10),
      partial: (d.total_transactions || 0) < EVENTS_PER_DAY * COMPLETE_HOUR_RATIO,
    }));

  // Radar: latest COMPLETE hour (the hour in progress would look tiny).
  const completeHours = hourly
    .filter(isCompleteHour)
    .sort((a, b) => new Date(a.hour_start) - new Date(b.hour_start));
  const latestHour = completeHours[completeHours.length - 1];
  const recent = completeHours.slice(-24);
  const avgCost = recent.length
    ? recent.reduce((sum, h) => sum + (h.total_cost || 0), 0) / recent.length
    : 0;

  const radarData = latestHour ? [
    { metric: 'Revenue',  value: avgCost ? Math.min(((latestHour.total_cost || 0) / avgCost) * 50, 100) : 0 },
    { metric: 'Orders',   value: Math.min(((latestHour.total_transactions || 0) / EVENTS_PER_HOUR) * 100, 100) },
    { metric: 'Rating',   value: ((latestHour.avg_rating || 0) / 5) * 100 },
    { metric: 'On-Time',  value: (latestHour.on_time_rate || 0) * 100 },
    { metric: 'Discount', value: Math.max(100 - (latestHour.avg_discount || 0), 0) },
  ] : [];

  if (loading) return (
    <div className="page-content">
      <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>Loading analytics…</div>
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
          <div className="section-title">Business Analytics</div>
          <div className="section-desc">7-day historical performance deep-dive · days are UTC days</div>
        </div>
      </div>

      {/* Daily Revenue vs Orders */}
      <div className="charts-grid" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: 24 }}>
        <div className="chart-card">
          <div className="chart-title" title="Revenue = total product cost (USD)">Daily Revenue (Last 7 Days)</div>
          <div className="chart-subtitle">Total product cost per day</div>
          {dailyChart.length === 0 ? (
            <div style={{ height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              No data in this window
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => formatMoney(v, { axis: true })}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickLine={false} axisLine={false} width={56}
                />
                <Tooltip
                  formatter={(v) => [formatMoney(v), 'Revenue']}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--text-muted)' }}
                />
                <Bar dataKey="revenue" fill="#6366f1" fillOpacity={0.85} radius={[6, 6, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* KPI Radar */}
        <div className="chart-card">
          <div className="chart-title">Operations Radar</div>
          <div className="chart-subtitle">Latest complete hour (0–100; revenue 50 = 24h average)</div>
          {radarData.length === 0 ? (
            <div style={{ height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              No complete hour yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Score" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          )}
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
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 8 }} />
            <Line type="monotone" dataKey="rating"   name="Avg Rating"     stroke="#f59e0b" strokeWidth={2.5} dot={false} animationDuration={600} />
            <Line type="monotone" dataKey="onTime"   name="On-Time (%)"    stroke="#10b981" strokeWidth={2.5} dot={false} animationDuration={600} />
            <Line type="monotone" dataKey="discount" name="Avg Discount %" stroke="#ef4444" strokeWidth={2}   dot={false} strokeDasharray="5 3" animationDuration={600} />
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
                <th>Date (UTC)</th><th>Revenue</th><th>Orders</th>
                <th>Avg Rating</th><th>On-Time %</th><th>Avg Discount</th>
              </tr>
            </thead>
            <tbody>
              {dailyChart.slice().reverse().map((d) => (
                <tr key={d.day}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {d.day}
                    {d.inProgress && <span className="badge badge-info" style={{ marginLeft: 8 }}>in progress</span>}
                    {!d.inProgress && d.partial && <span className="badge badge-warning" style={{ marginLeft: 8 }}>partial data</span>}
                  </td>
                  <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatMoney(d.revenue)}</td>
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
