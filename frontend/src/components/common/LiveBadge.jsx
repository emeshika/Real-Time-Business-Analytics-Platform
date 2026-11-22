import { useState, useEffect } from 'react';
import { browserTimezoneLabel } from '../../utils/dateTime';

/**
 * LiveBadge — shows current WebSocket connection status.
 * Props: status = 'connected' | 'connecting' | 'disconnected'
 */
export default function LiveBadge({ status = 'disconnected', lastEventAt = null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  let label = 'STALE';
  if (lastEventAt) {
    const ageSeconds = Math.max(0, (Date.now() - new Date(lastEventAt).getTime()) / 1000);
    if (Number.isFinite(ageSeconds) && ageSeconds < 120) {
      label = 'LIVE';
    } else {
      const ageMinutes = Math.floor(ageSeconds / 60);
      label = `STALE - last event ${ageMinutes < 1 ? 'under 1m ago' : `${ageMinutes}m ago`}`;
    }
  } else {
    label = 'STALE - no recent event';
  }

  return (
    <span className={`live-badge ${label.startsWith('STALE') ? 'stale' : 'connected'}`}>
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
