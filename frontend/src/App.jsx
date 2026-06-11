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
  const { alerts, pushAlert, removeAlert } = useAlerts(5);

  // ── Connect WebSocket on mount ──────────────────────────────
  useEffect(() => {
    wsService.onStatus(setWsStatus);
    wsService.connect();
    return () => {
      wsService.offStatus(setWsStatus);
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
        alerts={alerts}
        pushAlert={pushAlert}
        removeAlert={removeAlert}
      />
    </BrowserRouter>
  );
}

// Separate component so useLocation() works inside BrowserRouter
function PageWrapper({ wsStatus, alerts, pushAlert, removeAlert }) {
  return (
    <div className="app-shell">
      <Sidebar wsStatus={wsStatus} />

      <div className="main-content">
        <PageTopbar wsStatus={wsStatus} alertCount={alerts.length} />

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
function PageTopbar({ wsStatus, alertCount }) {
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
      alertCount={alertCount}
    />
  );
}
