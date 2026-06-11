import LiveBadge, { LiveClock } from '../common/LiveBadge';

export default function Topbar({ title, subtitle, wsStatus, alertCount = 0 }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div>
          <div className="page-title">{title}</div>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>

      <div className="topbar-right">
        <LiveClock />
        <LiveBadge status={wsStatus} />

        {/* Notification bell */}
        <div className="btn-icon" style={{ position: 'relative' }}>
          🔔
          {alertCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 9, fontWeight: 700,
              borderRadius: '100px',
              padding: '1px 5px',
              minWidth: 16, textAlign: 'center',
            }}>
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </div>

        {/* Settings */}
        <div className="btn-icon">⚙️</div>

        {/* Avatar */}
        <div style={{
          width: 36, height: 36,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff',
          border: '2px solid var(--border-hover)',
          cursor: 'pointer', flexShrink: 0,
        }}>
          BI
        </div>
      </div>
    </header>
  );
}
