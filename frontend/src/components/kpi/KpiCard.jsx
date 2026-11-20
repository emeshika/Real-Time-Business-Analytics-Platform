import { useState, useEffect, useRef } from 'react';

/**
 * KpiCard
 * -------
 * Animated KPI metric card. Flashes accent colour when value changes.
 *
 * Props:
 *   label      — string  e.g. "Total Revenue"
 *   value      — string  formatted value e.g. "$142,830"
 *   change     — string  e.g. "+12.4%"
 *   changeDir  — 'up' | 'down' | 'neutral'
 *   accentColor— CSS color string
 */
export default function KpiCard({
  label,
  value,
  change,
  changeDir = 'neutral',
  accentColor = 'var(--primary)',
  iconBg = 'rgba(99,102,241,0.15)',
}) {
  const [flash, setFlash] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div className="kpi-card">
      {/* Top accent bar */}
      <div
        className="accent-bar"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />

      {/* Label */}
      <div className="kpi-label">{label}</div>

      {/* Value */}
      <div className={`kpi-value${flash ? ' flash' : ''}`}>{value}</div>

      {/* Change indicator */}
      {change && (
        <div className={`kpi-change ${changeDir}`}>
          <span>{change}</span>
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
            {' '}vs last period
          </span>
        </div>
      )}
    </div>
  );
}
