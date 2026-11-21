import { useEffect, useRef, useState } from 'react';
import LiveBadge, { LiveClock } from '../common/LiveBadge';
import { fetchAlerts } from '../../services/api';
import wsService from '../../services/websocket';
import { browserTimezoneLabel, formatBrowserDateTime } from '../../utils/dateTime';

export default function Topbar({ title, subtitle, wsStatus, alertCount = 0 }) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const initialised = useRef(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await fetchAlerts(50);
        setRecentAlerts(result.alerts || []);
        if (initialised.current) setUnread((current) => current);
        initialised.current = true;
      } catch {
        setRecentAlerts([]);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onAlert = (alert) => {
      setRecentAlerts((current) => [alert, ...current].slice(0, 50));
      setUnread((current) => current + 1);
    };
    wsService.on('new_alert', onAlert);
    return () => wsService.off('new_alert', onAlert);
  }, []);

  const toggleAlerts = () => {
    setAlertsOpen((open) => !open);
    if (!alertsOpen) setUnread(0);
  };

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
        <div
          className="topbar-text-button"
          style={{ position: 'relative', cursor: 'pointer' }}
          onClick={toggleAlerts}
        >
          Alerts
          {(unread + alertCount) > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 9, fontWeight: 700,
              borderRadius: '100px',
              padding: '1px 5px',
              minWidth: 16, textAlign: 'center',
            }}>
              {(unread + alertCount) > 9 ? '9+' : (unread + alertCount)}
            </span>
          )}
        </div>

        {/* Settings */}
        <div className="topbar-text-button">Menu</div>

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
      {alertsOpen && (
        <div className="alerts-panel">
          <div className="chart-title" style={{ marginBottom: 8 }}>Recent Alerts</div>
          {recentAlerts.length === 0 ? (
            <div className="chart-subtitle">No alerts recorded</div>
          ) : recentAlerts.map((alert, index) => (
            <div className="alerts-panel-item" key={alert._id || `${alert.created_at}-${index}`}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {alert.created_at ? formatBrowserDateTime(alert.created_at) : 'Unknown time'}
                {' '}{browserTimezoneLabel()}
                {' · '}<strong>{alert.severity || 'info'}</strong>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{alert.rule || 'Operational alert'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{alert.message}</div>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
