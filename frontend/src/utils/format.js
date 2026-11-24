// Shared formatting helpers so every page shows money the same way.

// Must match the backend (EVENTS_PER_HOUR / COMPLETE_HOUR_RATIO in config.py).
export const EVENTS_PER_HOUR = Number(import.meta.env.VITE_EVENTS_PER_HOUR) || 3600;
export const COMPLETE_HOUR_RATIO = 0.95;

/** An hourly bucket is complete when it holds (almost) all expected events. */
export const isCompleteHour = (doc) =>
  (doc?.total_transactions || 0) >= EVENTS_PER_HOUR * COMPLETE_HOUR_RATIO;

/**
 * $18.17M, $757.1K, $950.00. With { axis: true } the labels are shorter and
 * drop a trailing ".0" so chart ticks read $5M, $10M, $15M.
 */
export function formatMoney(value, { axis = false } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v)) return '$0';
  const abs = Math.abs(v);
  const trim = (s) => (axis ? s.replace(/\.0(?=[MK]$)/, '') : s);

  if (abs >= 1_000_000) return trim(`$${(v / 1_000_000).toFixed(axis ? 1 : 2)}M`);
  if (abs >= 1_000) return trim(`$${(v / 1_000).toFixed(1)}K`);
  return `$${v.toFixed(axis ? 0 : 2)}`;
}

/** "Nov 22, 14:30 – 15:30" in the browser time zone (hourly bucket start). */
export function formatHourRange(value) {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return '';
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const startText = start.toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const endText = end.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${startText} – ${endText}`;
}
