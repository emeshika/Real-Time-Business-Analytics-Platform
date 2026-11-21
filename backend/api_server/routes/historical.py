"""
routes/historical.py
--------------------
REST endpoints that serve **historical** data from MongoDB so the frontend
can display past reports, hourly/daily summaries, and recent transactions.

Endpoints
---------
GET /api/historical-data   – Recent raw transactions
GET /api/hourly-metrics    – Hourly aggregated summaries
GET /api/daily-metrics     – Daily aggregated summaries
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Query

from api_server.db import (
    get_daily_col,
    get_hourly_col,
    get_transactions_col,
    serialise_doc,
)

log = logging.getLogger("pulsebi.historical")

router = APIRouter(prefix="/api", tags=["Historical Data"])

# ── GET /api/historical-data ──────────────────────────────────────────────────


@router.get("/historical-data")
def get_historical_data(
    limit: int = Query(default=100, ge=1, le=1000, description="Max records to return"),
    source: str = Query(default="stream", description="Data provenance filter"),
):
    """
    Fetch the most recent raw transactions.

    Returns JSON::

        { "data": [ {...}, ... ], "count": 42 }
    """
    cursor = (
        get_transactions_col()
        .find(
            {"source": source, "id": {"$gte": 1, "$lte": 10999}},
            {"_id": 0},
        )
        .sort("event_time", -1)
        .limit(limit)
    )
    records = [serialise_doc(doc) for doc in cursor]
    log.info("Served %d historical records", len(records))
    return {"data": records, "count": len(records)}


# ── GET /api/hourly-metrics ───────────────────────────────────────────────────


@router.get("/hourly-metrics")
def get_hourly_metrics(
    limit: int = Query(default=24, ge=1, le=500, description="Max hours to return"),
):
    """
    Fetch the most recent hourly aggregation documents.

    Returns JSON::

        { "data": [ {...}, ... ], "count": 24 }
    """
    cursor = (
        get_hourly_col()
        .find({}, {"_id": 0})
        .sort("hour_start", -1)
        .limit(limit)
    )
    records = [serialise_doc(doc) for doc in cursor]
    log.info("Served %d hourly-metric records", len(records))
    return {"data": records, "count": len(records)}


# ── GET /api/daily-metrics ────────────────────────────────────────────────────


@router.get("/daily-metrics")
def get_daily_metrics(
    limit: int = Query(default=30, ge=1, le=365, description="Max days to return"),
):
    """
    Fetch the most recent daily aggregation documents.

    Returns JSON::

        { "data": [ {...}, ... ], "count": 30 }
    """
    cursor = (
        get_daily_col()
        .find({}, {"_id": 0})
        .sort("date_start", -1)
        .limit(limit)
    )
    records = [serialise_doc(doc) for doc in cursor]
    log.info("Served %d daily-metric records", len(records))
    return {"data": records, "count": len(records)}