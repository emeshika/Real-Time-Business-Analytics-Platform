"""
db.py
-----
Thin MongoDB helper for the API server.

Re-uses the same environment variables as Team 02's database.py so both
layers talk to the exact same database and collections.

Environment Variables
---------------------
MONGODB_URI                       (default: mongodb://localhost:27017)
MONGODB_DATABASE                  (default: stream_analytics)
MONGODB_TRANSACTIONS_COLLECTION   (default: transactions)
MONGODB_HOURLY_COLLECTION         (default: hourly_metrics)
MONGODB_DAILY_COLLECTION          (default: daily_metrics)
"""

import os
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(override=True)

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_MONGODB_URI = (
    "mongodb+srv://sandudul_db_user:WMDCHXt2h7ASSmSy@cluster0.apfqidv.mongodb.net/"
)
DEFAULT_DATABASE_NAME = "stream_analytics"
DEFAULT_TRANSACTIONS_COLLECTION = "transactions"
DEFAULT_HOURLY_COLLECTION = "hourly_metrics"
DEFAULT_DAILY_COLLECTION = "daily_metrics"
DEFAULT_PREDICTIONS_COLLECTION = "predictions"
DEFAULT_ALERTS_COLLECTION = "alerts"


# ── Singleton-style connection ────────────────────────────────────────────────

_client: Optional[MongoClient] = None


def get_client() -> MongoClient:
    """Return (or create) a module-level MongoClient."""
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI", DEFAULT_MONGODB_URI)
        _client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    return _client


def get_database():
    """Return the pymongo Database object."""
    db_name = os.getenv("MONGODB_DATABASE", DEFAULT_DATABASE_NAME)
    return get_client()[db_name]


def get_transactions_col():
    """Return the transactions collection."""
    name = os.getenv("MONGODB_TRANSACTIONS_COLLECTION", DEFAULT_TRANSACTIONS_COLLECTION)
    return get_database()[name]


def get_hourly_col():
    """Return the hourly_metrics collection."""
    name = os.getenv("MONGODB_HOURLY_COLLECTION", DEFAULT_HOURLY_COLLECTION)
    return get_database()[name]


def get_daily_col():
    """Return the daily_metrics collection."""
    name = os.getenv("MONGODB_DAILY_COLLECTION", DEFAULT_DAILY_COLLECTION)
    return get_database()[name]


def get_predictions_col():
    """Return the predictions collection (Team 03's ML output)."""
    name = os.getenv("MONGODB_PREDICTIONS_COLLECTION", DEFAULT_PREDICTIONS_COLLECTION)
    return get_database()[name]


def get_alerts_col():
    """Return the operational alerts collection."""
    name = os.getenv("MONGODB_ALERTS_COLLECTION", DEFAULT_ALERTS_COLLECTION)
    return get_database()[name]


# ── Serialisation helper ─────────────────────────────────────────────────────

def serialise_doc(doc: dict) -> dict:
    """
    Make a MongoDB document JSON-safe:
    - Remove ``_id`` (ObjectId is not serialisable).
    - Convert ``datetime`` values to ISO-8601 strings.
    """
    if doc is None:
        return {}
    doc.pop("_id", None)
    for key, val in doc.items():
        if isinstance(val, datetime):
            utc_val = val.astimezone(timezone.utc) if val.tzinfo else val.replace(tzinfo=timezone.utc)
            doc[key] = utc_val.isoformat().replace("+00:00", "Z")
    return doc


def close():
    """Close the module-level MongoClient (call on shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
