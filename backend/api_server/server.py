"""
server.py
---------
Main FastAPI application for PulseBI (Couple 04).

Responsibilities
~~~~~~~~~~~~~~~~
1. Serve REST endpoints for historical data & ML predictions.
2. Accept WebSocket connections and push live transactions/predictions
   to every connected frontend client in real time.

Run
~~~
    cd backend
    uvicorn api_server.server:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from api_server import db
from api_server.routes.historical import router as historical_router
from api_server.routes.predictions import router as predictions_router
from api_server.routes.alerts import router as alerts_router
from api_server.websocket_handler import manager

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pulsebi.server")

# ── Background watchers ──────────────────────────────────────────────────────


async def _watch_transactions() -> None:
    """
    Poll MongoDB for new transactions every 2 seconds and broadcast
    the latest record to all connected WebSocket clients.
    """
    col = db.get_transactions_col()
    last_count = col.count_documents({})
    log.info("Transaction watcher started  (baseline count=%d)", last_count)

    while True:
        await asyncio.sleep(2)
        try:
            current_count = col.count_documents({})
            if current_count > last_count:
                # Fetch only the newest records since last check
                new_records = list(
                    col.find({}, {"_id": 0})
                    .sort("processed_at", -1)
                    .limit(current_count - last_count)
                )
                for doc in reversed(new_records):
                    await manager.broadcast(
                        {"type": "new_transaction", "data": db.serialise_doc(doc)}
                    )
                last_count = current_count
        except Exception as exc:
            log.error("Transaction watcher error: %s", exc)


async def _watch_predictions() -> None:
    """
    Poll MongoDB for new ML predictions every 5 seconds and broadcast
    the latest prediction to all connected WebSocket clients.
    """
    col = db.get_predictions_col()
    last_count = col.count_documents({})
    log.info("Prediction watcher started  (baseline count=%d)", last_count)

    while True:
        await asyncio.sleep(5)
        try:
            current_count = col.count_documents({})
            if current_count > last_count:
                latest = col.find_one(
                    {}, {"_id": 0}, sort=[("created_at", -1)]
                )
                if latest:
                    await manager.broadcast(
                        {"type": "new_prediction", "data": db.serialise_doc(latest)}
                    )
                last_count = current_count
        except Exception as exc:
            log.error("Prediction watcher error: %s", exc)


async def _watch_alerts() -> None:
    """Poll the alerts collection and broadcast newly-created alerts."""
    col = db.get_alerts_col()
    last_count = col.count_documents({})
    log.info("Alert watcher started (baseline count=%d)", last_count)

    while True:
        await asyncio.sleep(3)
        try:
            current_count = col.count_documents({})
            if current_count > last_count:
                latest = list(
                    col.find({}, {"_id": 0})
                    .sort("created_at", -1)
                    .limit(current_count - last_count)
                )
                for alert in reversed(latest):
                    await manager.broadcast(
                        {"type": "new_alert", "data": db.serialise_doc(alert)}
                    )
                last_count = current_count
        except Exception as exc:
            log.error("Alert watcher error: %s", exc)


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background watchers on boot; clean up on shutdown."""
    log.info("🚀  PulseBI API starting up …")

    # Verify MongoDB is reachable
    db.get_client().admin.command("ping")
    log.info("✅  MongoDB connection OK")

    # Launch background watchers
    tx_task = asyncio.create_task(_watch_transactions())
    pred_task = asyncio.create_task(_watch_predictions())
    alert_task = asyncio.create_task(_watch_alerts())

    yield  # ── app is running ──

    # Shutdown
    tx_task.cancel()
    pred_task.cancel()
    alert_task.cancel()
    db.close()
    log.info("🛑  PulseBI API shut down.")


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="PulseBI API",
    description="Real-time Business Intelligence backend – REST + WebSocket",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS – allow the React frontend (Couple 05) to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register REST routers ────────────────────────────────────────────────────

app.include_router(historical_router)
app.include_router(predictions_router)
app.include_router(alerts_router)

# ── Health check ──────────────────────────────────────────────────────────────


@app.get("/api/health", tags=["Health"])
def health_check():
    """Simple liveness probe."""
    return {
        "status": "ok",
        "websocket_clients": manager.client_count,
    }


# ── WebSocket endpoint ───────────────────────────────────────────────────────


@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    """
    Frontend connects here to receive live data pushes.

    Messages pushed to the client look like::

        { "type": "new_transaction", "data": { … } }
        { "type": "new_prediction",  "data": { … } }
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive; ignore any client messages for now
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)