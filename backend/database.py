"""
database.py
-----------
MongoDB connection helper and aggregation logic for the PulseBI
stream-analytics pipeline.

Collections
-----------
- **transactions**     : Raw, cleaned streaming events.
- **hourly_metrics**   : Aggregated summary data per hour.
- **daily_metrics**    : Aggregated summary data per day.

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

from dotenv import load_dotenv
from pymongo import ASCENDING, MongoClient, ReturnDocument

# Load environment variables
load_dotenv(override=True)

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_MONGODB_URI = "mongodb://localhost:27017"
DEFAULT_DATABASE_NAME = "stream_analytics"
DEFAULT_TRANSACTIONS_COLLECTION = "transactions"
DEFAULT_HOURLY_METRICS_COLLECTION = "hourly_metrics"
DEFAULT_DAILY_METRICS_COLLECTION = "daily_metrics"
DEFAULT_ALERTS_COLLECTION = "alerts"


# ── Connection helpers ────────────────────────────────────────────────────────

def get_client() -> MongoClient:
    """Return a MongoClient configured from env-vars or defaults."""
    uri = os.getenv("MONGODB_URI", DEFAULT_MONGODB_URI)
    return MongoClient(uri, serverSelectionTimeoutMS=5000)


def get_collections():
    """
    Return (client, transactions_col, hourly_col, daily_col).

    The caller owns the client and is responsible for closing it.
    """
    client = get_client()
    db_name = os.getenv("MONGODB_DATABASE", DEFAULT_DATABASE_NAME)

    transactions_name = os.getenv(
        "MONGODB_TRANSACTIONS_COLLECTION",
        DEFAULT_TRANSACTIONS_COLLECTION,
    )
    hourly_name = os.getenv(
        "MONGODB_HOURLY_COLLECTION",
        DEFAULT_HOURLY_METRICS_COLLECTION,
    )
    daily_name = os.getenv(
        "MONGODB_DAILY_COLLECTION",
        DEFAULT_DAILY_METRICS_COLLECTION,
    )

    db = client[db_name]
    return client, db[transactions_name], db[hourly_name], db[daily_name]


# ── Index creation ────────────────────────────────────────────────────────────

def ensure_indexes(transactions_col, hourly_col, daily_col):
    """Create indexes for performant queries on all three collections."""

    # Transactions indexes
    transactions_col.create_index("event_time")
    transactions_col.create_index("hour_start")
    transactions_col.create_index("mode_of_shipment")
    transactions_col.create_index("warehouse_block")
    transactions_col.create_index(
        [("hour_start", ASCENDING), ("mode_of_shipment", ASCENDING)]
    )

    # Hourly metrics — one document per hour
    hourly_col.create_index("hour_start", unique=True)

    # Daily metrics — one document per day
    daily_col.create_index("date_start", unique=True)


# ── Aggregation helpers ──────────────────────────────────────────────────────

def _build_update(time_key, time_value, metrics_delta, source="stream"):
    """
    Build the MongoDB update document used by both hourly and daily upserts.

    The update atomically increments counters and categorical breakdowns,
    then recomputes derived averages in a second pass.
    """
    now = datetime.now(timezone.utc)

    # Categorical breakdown keys — use dot notation for nested $inc
    shipment_mode = metrics_delta.get("mode_of_shipment", "Unknown")
    warehouse = metrics_delta.get("warehouse_block", "Unknown")
    gender = metrics_delta.get("gender", "Unknown")
    importance = metrics_delta.get("product_importance", "Unknown")

    total_transactions = int(metrics_delta.get("total_transactions", 1))
    update = {
        "$setOnInsert": {time_key: time_value, "created_at": now, "source": source},
        "$inc": {
            "total_transactions": total_transactions,
            "total_cost": float(metrics_delta.get("total_cost", 0.0)),
            "discount_sum": float(metrics_delta.get("discount_sum", 0.0)),
            "on_time_sum": int(metrics_delta.get("on_time_sum", 0)),
            "rating_sum": int(metrics_delta.get("rating_sum", 0)),
            "total_weight": float(metrics_delta.get("total_weight", 0.0)),
            # Categorical breakdowns via dot-notation
        },
        "$set": {"updated_at": now},
    }
    shipment_counts = metrics_delta.get("shipment_mode_counts")
    if isinstance(shipment_counts, dict):
        for name, count in shipment_counts.items():
            update["$inc"][f"shipment_mode_counts.{name}"] = int(count)
    else:
        update["$inc"][f"shipment_mode_counts.{shipment_mode}"] = 1
    warehouse_counts = metrics_delta.get("warehouse_block_counts")
    if isinstance(warehouse_counts, dict):
        for name, count in warehouse_counts.items():
            update["$inc"][f"warehouse_block_counts.{name}"] = int(count)
    else:
        update["$inc"][f"warehouse_block_counts.{warehouse}"] = 1
    gender_counts = metrics_delta.get("gender_counts")
    if isinstance(gender_counts, dict):
        for name, count in gender_counts.items():
            update["$inc"][f"gender_counts.{name}"] = int(count)
    else:
        update["$inc"][f"gender_counts.{gender}"] = 1
    importance_counts = metrics_delta.get("product_importance_counts")
    if isinstance(importance_counts, dict):
        for name, count in importance_counts.items():
            update["$inc"][f"product_importance_counts.{name}"] = int(count)
    else:
        update["$inc"][f"product_importance_counts.{importance}"] = 1
    return update


def _recompute_averages(collection, doc_id, updated_doc):
    """Recompute derived average fields from the running totals."""
    total = updated_doc.get("total_transactions", 0) or 0
    if total == 0:
        return

    avg_discount = float(updated_doc.get("discount_sum", 0.0)) / total
    on_time_rate = float(updated_doc.get("on_time_sum", 0)) / total
    avg_rating = float(updated_doc.get("rating_sum", 0)) / total
    updated_doc["avg_discount"] = round(avg_discount, 4)
    updated_doc["on_time_rate"] = round(on_time_rate, 4)
    updated_doc["avg_rating"] = round(avg_rating, 4)

    collection.update_one(
        {"_id": doc_id},
        {
            "$set": {
                "avg_discount": round(avg_discount, 4),
                "on_time_rate": round(on_time_rate, 4),
                "avg_rating": round(avg_rating, 4),
            }
        },
    )


# ── Public API ────────────────────────────────────────────────────────────────

def update_hourly_metrics(hourly_col, hour_start, metrics_delta, source="stream"):
    """
    Atomically upsert the hourly-metrics document for *hour_start*
    and recompute derived averages.

    Returns the updated document.
    """
    update = _build_update("hour_start", hour_start, metrics_delta, source=source)
    updated = hourly_col.find_one_and_update(
        {"hour_start": hour_start},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    _recompute_averages(hourly_col, updated["_id"], updated)
    return updated


def update_daily_metrics(daily_col, date_start, metrics_delta, source="stream"):
    """
    Atomically upsert the daily-metrics document for *date_start*
    (midnight UTC of the day) and recompute derived averages.

    Returns the updated document.
    """
    update = _build_update("date_start", date_start, metrics_delta, source=source)
    updated = daily_col.find_one_and_update(
        {"date_start": date_start},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    _recompute_averages(daily_col, updated["_id"], updated)
    return updated


def build_metric_delta(cleaned):
    """Build one MongoDB aggregation delta from a cleaned transaction."""
    return {
        "total_cost": cleaned.get("cost_of_product", 0.0),
        "discount_sum": cleaned.get("discount_offered", 0.0),
        "on_time_sum": cleaned.get("reached_on_time", 0),
        "rating_sum": cleaned.get("customer_rating", 0),
        "total_weight": cleaned.get("weight_in_gms", 0.0),
        "mode_of_shipment": cleaned.get("mode_of_shipment", "Unknown"),
        "warehouse_block": cleaned.get("warehouse_block", "Unknown"),
        "gender": cleaned.get("gender", "Unknown"),
        "product_importance": cleaned.get("product_importance", "Unknown"),
    }


def create_hourly_alerts(alerts_col, hourly_col, hour_start, hourly_doc):
    """Create cooldowned operational alerts after an hourly metric update."""
    from datetime import timedelta

    alerts = []
    hour_iso = hour_start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    on_time_rate = float(hourly_doc.get("on_time_rate", 0.0) or 0.0) * 100

    rules = []
    if on_time_rate < 65:
        rules.append({
            "rule": "low_on_time_delivery",
            "severity": "high",
            "message": f"Hourly on-time delivery is {on_time_rate:.1f}% (below 65%).",
        })

    previous_hour = hour_start - timedelta(hours=1)
    previous = hourly_col.find_one({"hour_start": previous_hour})
    current_revenue = float(hourly_doc.get("total_cost", 0.0) or 0.0)
    previous_revenue = float(previous.get("total_cost", 0.0) or 0.0) if previous else None
    if previous_revenue not in (None, 0):
        drop_pct = (current_revenue - previous_revenue) / previous_revenue * 100
        if drop_pct <= -40:
            rules.append({
                "rule": "hourly_revenue_drop",
                "severity": "high",
                "message": f"Hourly revenue dropped {abs(drop_pct):.1f}% versus the previous completed hour.",
            })

    for rule in rules:
        existing = alerts_col.find_one({"target_hour": hour_iso, "rule": rule["rule"]})
        if existing:
            continue
        alert = {
            "source": "stream",
            "target_hour": hour_iso,
            "rule": rule["rule"],
            "severity": rule["severity"],
            "message": rule["message"],
            "created_at": datetime.now(timezone.utc),
        }
        result = alerts_col.insert_one(alert)
        alert["_id"] = result.inserted_id
        alerts.append(alert)
    return alerts
