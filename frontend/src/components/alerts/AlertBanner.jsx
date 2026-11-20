import { useState, useCallback, useEffect } from 'react';

let idCounter = 0;

/**
 * AlertBanner
 * -----------
 * Notification popup container. Alerts slide in from the right.
 *
 * Usage:
 *   const { alerts, pushAlert, removeAlert } = useAlerts();
 *   <AlertBanner alerts={alerts} onClose={removeAlert} />
 *
 *   pushAlert({ type: 'anomaly', title: '...', message: '...' })
 */

export function useAlerts(maxAlerts = 5) {
  const [alerts, setAlerts] = useState([]);

  const pushAlert = useCallback((alert) => {
    const id = ++idCounter;
    setAlerts((prev) => [{ ...alert, id }, ...prev].slice(0, maxAlerts));
    // Auto-dismiss after 8 seconds
    setTimeout(() => removeAlert(id), 8000);
  }, [maxAlerts]);

  const removeAlert = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { alerts, pushAlert, removeAlert };
}

const ALERT_CONFIG = {
  anomaly:    { defaultTitle: 'Anomaly Detected' },
  prediction: { defaultTitle: 'New Prediction'   },
  info:       { defaultTitle: 'System Update'    },
  success:    { defaultTitle: 'Success'           },
};

export default function AlertBanner({ alerts, onClose }) {
  if (!alerts?.length) return null;

  return (
    <div className="alerts-container">
      {alerts.map((alert) => {
        const config = ALERT_CONFIG[alert.type] || ALERT_CONFIG.info;
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });

        return (
          <div key={alert.id} className={`alert-item ${alert.type || 'info'}`}>
            <div className="alert-content">
              <div className="alert-title">{alert.title || config.defaultTitle}</div>
              <div className="alert-message">{alert.message}</div>
              <div className="alert-time">{ts}</div>
            </div>
            <button className="alert-close" onClick={() => onClose(alert.id)}>×</button>
          </div>
        );
      })}
    </div>
  );
}
