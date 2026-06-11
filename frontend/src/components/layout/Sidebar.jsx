import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/',            icon: '⚡', label: 'Dashboard'   },
  { to: '/analytics',  icon: '📊', label: 'Analytics'   },
  { to: '/predictions',icon: '🤖', label: 'Predictions' },
];

export default function Sidebar({ wsStatus }) {
  const statusColor =
    wsStatus === 'connected'   ? 'var(--success)' :
    wsStatus === 'connecting'  ? 'var(--warning)' :
                                 'var(--danger)';

  const statusText =
    wsStatus === 'connected'   ? 'Live stream active' :
    wsStatus === 'connecting'  ? 'Connecting...'      :
                                 'Stream offline';

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon">⚡</div>
        <span className="logo-text">PulseBI</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>
        {NAV_ITEMS.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}

        <div className="nav-section-label" style={{ marginTop: 24 }}>System</div>
        <div className="nav-item" style={{ cursor: 'default' }}>
          <span className="nav-icon">🗄️</span>
          <span>MongoDB</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--success)' }}>●</span>
        </div>
        <div className="nav-item" style={{ cursor: 'default' }}>
          <span className="nav-icon">🔀</span>
          <span>Kafka</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--success)' }}>●</span>
        </div>
        <div className="nav-item" style={{ cursor: 'default' }}>
          <span className="nav-icon">🧠</span>
          <span>ML Engine</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)' }}>●</span>
        </div>
      </nav>

      {/* WebSocket status footer */}
      <div className="sidebar-footer">
        <div className="ws-status">
          <span style={{ fontSize: 10, color: statusColor }}>●</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
              WebSocket
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusText}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          PulseBI v1.0 · Real-Time BI
        </div>
      </div>
    </aside>
  );
}
