import { useState, useEffect } from 'react';
import { browserTimezoneLabel } from '../../utils/dateTime';

/**
 * LiveBadge — shows current WebSocket connection status.
 * Props: status = 'connected' | 'connecting' | 'disconnected'
 */
export default function LiveBadge({ status = 'disconnected' }) {
  const label = status === 'connected'
    ? 'LIVE'
    : status === 'connecting'
    ? 'CONNECTING'
    : 'LIVE';

  return (
    <span className={`live-badge ${status}`}>
      <span className="pulse-dot" />
      {label}
    </span>
  );
}

/**
 * LiveClock — ticking clock in topbar
 */
export function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="live-clock" title={`Browser local timezone: ${browserTimezoneLabel()}`}>
      {time.toLocaleTimeString(undefined, { hour12: false })}
      {' '}
      {browserTimezoneLabel()}
    </span>
  );
}
