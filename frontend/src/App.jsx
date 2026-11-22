import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Topbar  from './components/layout/Topbar';
import AlertBanner, { useAlerts } from './components/alerts/AlertBanner';
import Dashboard   from './pages/Dashboard';
import Analytics   from './pages/Analytics';
import Predictions from './pages/Predictions';
import wsService   from './services/websocket';
import './index.css';

const PAGE_META = {
  '/':            { title: 'Live Dashboard',  subtitle: 'Real-time business operations monitor' },
  '/analytics':   { title: 'Analytics',       subtitle: 'Deep-dive historical performance analysis' },
  '/predictions': { title: 'ML Predictions',  subtitle: 'XGBoost revenue forecasting engine' },
};

export default function App() {
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [lastStreamEvent, setLastStreamEvent] = useState(null);
  const { alerts, pushAlert, removeAlert } = useAlerts(5);

  // ── Connect WebSocket on mount ──────────────────────────────
  useEffect(() => {
    wsService.onStatus(setWsStatus);
    const onTransaction = (data) => {
      setLastStreamEvent(data.event_time || data.timestamp || new Date().toISOString());
    };
    wsService.on('new_transaction', onTransaction);
    wsService.connect();
    return () => {
      wsService.offStatus(setWsStatus);
      wsService.off('new_transaction', onTransaction);
      wsService.disconnect();
    };
  }, []);

  // ── Resolve page title from current path ────────────────────
  const path   = window.location.pathname.replace(/\/$/, '') || '/';
  const meta   = PAGE_META[path] ?? PAGE_META['/'];

  return (
    <BrowserRouter>
      <PageWrapper
        wsStatus={wsStatus}
        lastStreamEvent={lastStreamEvent}
        alerts={alerts}
        pushAlert={pushAlert}
        removeAlert={removeAlert}
      />
    </BrowserRouter>
  );
}

// Separate component so useLocation() works inside BrowserRouter
function PageWrapper({ wsStatus, lastStreamEvent, alerts, pushAlert, removeAlert }) {
  return (
    <div className="app-shell">
      <Sidebar wsStatus={wsStatus} />

      <div className="main-content">
        <PageTopbar wsStatus={wsStatus} lastStreamEvent={lastStreamEvent} alertCount={alerts.length} />

        <Routes>
          <Route path="/"            element={<Dashboard   wsStatus={wsStatus} pushAlert={pushAlert} />} />
          <Route path="/analytics"   element={<Analytics />} />
          <Route path="/predictions" element={<Predictions />} />
        </Routes>
      </div>

      <AlertBanner alerts={alerts} onClose={removeAlert} />
    </div>
  );
}

// Topbar that reads the current route for title
function PageTopbar({ wsStatus, lastStreamEvent, alertCount }) {
  const path = window.location.pathname;
  // Match most specific first
  const meta =
    path.includes('/predictions') ? PAGE_META['/predictions'] :
    path.includes('/analytics')   ? PAGE_META['/analytics']   :
                                     PAGE_META['/'];

  // Re-render on navigation (listen to popstate + React Router changes)
  const [, rerender] = useState(0);
  useEffect(() => {
    const handler = () => rerender((n) => n + 1);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return (
    <Topbar
      title={meta.title}
      subtitle={meta.subtitle}
      wsStatus={wsStatus}
      lastStreamEvent={lastStreamEvent}
      alertCount={alertCount}
    />
  );
}
