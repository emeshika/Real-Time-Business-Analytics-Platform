/**
 * websocket.js
 * ------------
 * WebSocket client for PulseBI live data stream.
 *
 * Connects to ws://localhost:8000/ws/live and dispatches:
 *   { type: "new_transaction", data: {...} }
 *   { type: "new_prediction",  data: {...} }
 *
 * Auto-reconnects on disconnect with exponential back-off.
 *
 * Usage:
 *   import wsService from './services/websocket';
 *   wsService.connect();
 *   wsService.on('new_transaction', handler);
 *   wsService.on('new_prediction', handler);
 *   wsService.off('new_transaction', handler);
 *   wsService.disconnect();
 */

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/live';
const MAX_RETRIES = 10;
const BASE_DELAY = 2000;

class WebSocketService {
  constructor() {
    this._ws = null;
    this._listeners = {};      // { eventType: Set<fn> }
    this._statusListeners = new Set();
    this._retryCount = 0;
    this._retryTimer = null;
    this._status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected'
    this._intentionalClose = false;
  }

  // ── Status ─────────────────────────────────────────────────
  get status() { return this._status; }

  _setStatus(s) {
    this._status = s;
    this._statusListeners.forEach((fn) => fn(s));
  }

  onStatus(fn) { this._statusListeners.add(fn); }
  offStatus(fn) { this._statusListeners.delete(fn); }

  // ── Event listeners ────────────────────────────────────────
  on(eventType, fn) {
    if (!this._listeners[eventType]) this._listeners[eventType] = new Set();
    this._listeners[eventType].add(fn);
  }

  off(eventType, fn) {
    this._listeners[eventType]?.delete(fn);
  }

  _emit(eventType, data) {
    this._listeners[eventType]?.forEach((fn) => {
      try { fn(data); } catch (e) { console.error('[WS] listener error:', e); }
    });
  }

  // ── Connect ────────────────────────────────────────────────
  connect() {
    if (this._ws && this._ws.readyState < 2) return; // already open/connecting
    this._intentionalClose = false;
    this._doConnect();
  }

  _doConnect() {
  this._setStatus('connecting');
  let ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    this._scheduleRetry();
    return;
  }
  this._ws = ws;

  ws.onopen = () => {
    if (this._ws !== ws) { ws.close(); return; }   // stale socket
    console.info('[PulseBI WS] Connected');
    this._retryCount = 0;
    this._setStatus('connected');
  };

  ws.onmessage = (event) => {
    if (this._ws !== ws) return;                    // ignore stale socket
    try {
      const msg = JSON.parse(event.data);
      if (msg?.type) this._emit(msg.type, msg.data ?? msg);
    } catch {
      console.warn('[PulseBI WS] Unparseable message:', event.data);
    }
  };

  ws.onerror = (err) => {
    if (this._ws === ws) console.warn('[PulseBI WS] Error:', err);
  };

  ws.onclose = (evt) => {
    if (this._ws !== ws) return;                    // old socket: no retry
    this._setStatus('disconnected');
    console.info(`[PulseBI WS] Closed (code=${evt.code})`);
    if (!this._intentionalClose) this._scheduleRetry();
  };
}

  _scheduleRetry() {
    if (this._retryCount >= MAX_RETRIES) {
      console.error('[PulseBI WS] Max retries reached. Giving up.');
      return;
    }
    const delay = Math.min(BASE_DELAY * 2 ** this._retryCount, 30000);
    this._retryCount++;
    console.info(`[PulseBI WS] Reconnecting in ${delay}ms (attempt ${this._retryCount})`);
    this._retryTimer = setTimeout(() => this._doConnect(), delay);
  }

  // ── Disconnect ─────────────────────────────────────────────
  disconnect() {
    this._intentionalClose = true;
    clearTimeout(this._retryTimer);
    this._ws?.close();
    this._ws = null;
    this._setStatus('disconnected');
  }
}

// Module-level singleton
const wsService = new WebSocketService();
export default wsService;
