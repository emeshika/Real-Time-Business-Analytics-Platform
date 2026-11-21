"""
websocket_handler.py
--------------------
Manages WebSocket connections and broadcasts live data to all connected
frontend clients.

Usage (inside server.py)::

    from api_server.websocket_handler import manager

    @app.websocket("/ws/live")
    async def ws_endpoint(websocket: WebSocket):
        await manager.connect(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, List, Dict

from fastapi import WebSocket

log = logging.getLogger("pulsebi.ws")

# ── Connection Manager ────────────────────────────────────────────────────────


class ConnectionManager:
    """Keep track of every active WebSocket and broadcast to all of them."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    # -- lifecycle --

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket and register it."""
        await websocket.accept()
        self.active_connections.append(websocket)
        log.info(
            "✅  Client connected  (total=%d)", len(self.active_connections)
        )

    def disconnect(self, websocket: WebSocket) -> None:
        """Un-register a disconnected WebSocket."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        log.info(
            "❌  Client disconnected  (total=%d)", len(self.active_connections)
        )

    # -- broadcasting --

    async def broadcast(self, data: Dict[str, Any]) -> None:
        """
        Send *data* to **every** connected client.

        Silently removes connections that have gone stale.
        """
        if not self.active_connections:
            return

        payload = json.dumps(data, default=_json_default)
        stale: List[WebSocket] = []

        for ws in self.active_connections:
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)

        for ws in stale:
            self.active_connections.remove(ws)
            log.warning("Removed stale connection (total=%d)", len(self.active_connections))

        if self.active_connections:
            log.info(
                "📡  Broadcasted to %d client(s)", len(self.active_connections)
            )

    @property
    def client_count(self) -> int:
        return len(self.active_connections)


# ── JSON helper ───────────────────────────────────────────────────────────────


def _json_default(obj: Any) -> str:
    """Handle datetime serialisation inside ``json.dumps``."""
    if isinstance(obj, datetime):
        utc_val = obj.astimezone(timezone.utc) if obj.tzinfo else obj.replace(tzinfo=timezone.utc)
        return utc_val.isoformat().replace("+00:00", "Z")
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


# ── Module-level singleton ────────────────────────────────────────────────────

manager = ConnectionManager()