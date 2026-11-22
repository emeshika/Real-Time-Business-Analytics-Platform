"""
kafka_consumer.py
-----------------
Reads cleaned live JSON data from Kafka, computes real-time aggregations,
and stores both raw transactions and hourly/daily summary metrics into MongoDB.

Prerequisites
-------------
1. Kafka running on KAFKA_BOOTSTRAP_SERVERS (default localhost:9092)
2. MongoDB running on MONGODB_URI (default localhost:27017)
3. pip install -r requirements.txt

Run:
    python kafka_consumer.py
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

from kafka import KafkaConsumer
from kafka.errors import NoBrokersAvailable
from pymongo.errors import PyMongoError

from database import (
    ensure_indexes,
    get_collections,
    update_daily_metrics,
    update_hourly_metrics,
    build_metric_delta,
    create_hourly_alerts,
)
from data_mapping import kaggle_to_on_time

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9092")
TOPIC_NAME = os.getenv("KAFKA_TOPIC", "live-business-transactions")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Connect to Kafka
# ══════════════════════════════════════════════════════════════════════════════

log.info("Connecting to Kafka at %s …", BOOTSTRAP_SERVERS)

try:
    consumer = KafkaConsumer(
        TOPIC_NAME,
        bootstrap_servers=BOOTSTRAP_SERVERS,
        api_version=(4, 0, 0),
        auto_offset_reset="latest",
        value_deserializer=lambda x: json.loads(x.decode("utf-8")),
    )
except NoBrokersAvailable:
    log.error(
        "Cannot reach Kafka on %s — is the broker running?",
        BOOTSTRAP_SERVERS,
    )
    sys.exit(1)

log.info("Connected to Kafka ✓")
log.info("Listening to topic: %s", TOPIC_NAME)
log.info("-" * 60)

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Connect to MongoDB
# ══════════════════════════════════════════════════════════════════════════════

try:
    db_client, transactions_col, hourly_col, daily_col = get_collections()
    alerts_col = db_client[os.getenv("MONGODB_DATABASE", "stream_analytics")][
        os.getenv("MONGODB_ALERTS_COLLECTION", "alerts")
    ]
    alerts_col.create_index("created_at")
    alerts_col.create_index([("target_hour", 1), ("rule", 1)], unique=True)
    db_client.admin.command("ping")
    ensure_indexes(transactions_col, hourly_col, daily_col)
    log.info("Connected to MongoDB ✓")
except PyMongoError as exc:
    raise SystemExit(f"MongoDB connection failed: {exc}")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Data-Cleaning Utilities
# ══════════════════════════════════════════════════════════════════════════════


def coerce_int(value, default=0):
    """Safely cast *value* to int, returning *default* on failure."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def coerce_float(value, default=0.0):
    """Safely cast *value* to float, returning *default* on failure."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_event_time(value):
    """Parse an ISO-8601 timestamp string into a UTC datetime."""
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def get_hour_start(event_time):
    """Return *event_time* truncated to the start of its hour."""
    return event_time.replace(minute=0, second=0, microsecond=0)


def get_date_start(event_time):
    """Return *event_time* truncated to midnight UTC of its day."""
    return event_time.replace(hour=0, minute=0, second=0, microsecond=0)


def clean_data(data):
    """
    Validate and normalise a raw Kafka message dict.

    - Fills missing categorical fields with 'Unknown'.
    - Coerces numeric fields to the correct type.
    - Strips any unwanted columns.
    """
    cleaned = data.copy()

    # Fill missing categorical fields
    if not cleaned.get("warehouse_block"):
        cleaned["warehouse_block"] = "Unknown"
    if not cleaned.get("mode_of_shipment"):
        cleaned["mode_of_shipment"] = "Unknown"
    if not cleaned.get("product_importance"):
        cleaned["product_importance"] = "Unknown"
    if not cleaned.get("gender"):
        cleaned["gender"] = "Unknown"

    # Normalise numeric fields
    cleaned["customer_care_calls"] = coerce_int(cleaned.get("customer_care_calls"))
    cleaned["customer_rating"] = coerce_int(cleaned.get("customer_rating"))
    cleaned["prior_purchases"] = coerce_int(cleaned.get("prior_purchases"))
    if "kaggle_reached_on_time" in cleaned:
        cleaned["reached_on_time"] = kaggle_to_on_time(cleaned["kaggle_reached_on_time"])
    else:
        cleaned["reached_on_time"] = coerce_int(cleaned.get("reached_on_time"))
    cleaned["cost_of_product"] = coerce_float(cleaned.get("cost_of_product"))
    cleaned["discount_offered"] = coerce_float(cleaned.get("discount_offered"))
    cleaned["weight_in_gms"] = coerce_float(cleaned.get("weight_in_gms"))

    # Remove unwanted fields (add column names here if needed)
    for col in []:
        cleaned.pop(col, None)

    return cleaned


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Build Aggregation Delta
# ══════════════════════════════════════════════════════════════════════════════


def build_metrics_delta(cleaned):
    """
    Construct the metrics-delta dict from a single cleaned record.

    This is passed to both ``update_hourly_metrics`` and
    ``update_daily_metrics`` to atomically increment counters.
    """
    return {
        # Numeric sums
        "total_cost": cleaned.get("cost_of_product", 0.0),
        "discount_sum": cleaned.get("discount_offered", 0.0),
        "on_time_sum": cleaned.get("reached_on_time", 0),
        "rating_sum": cleaned.get("customer_rating", 0),
        "total_weight": cleaned.get("weight_in_gms", 0.0),
        # Categorical breakdowns
        "mode_of_shipment": cleaned.get("mode_of_shipment", "Unknown"),
        "warehouse_block": cleaned.get("warehouse_block", "Unknown"),
        "gender": cleaned.get("gender", "Unknown"),
        "product_importance": cleaned.get("product_importance", "Unknown"),
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Main Consumer Loop: Read → Clean → Aggregate → Store
# ══════════════════════════════════════════════════════════════════════════════

record_count = 0

try:
    for message in consumer:
        raw_data = message.value

        # ── Clean ─────────────────────────────────────────────────────────
        cleaned_data = clean_data(raw_data)

        event_time = parse_event_time(cleaned_data.get("timestamp"))
        hour_start = get_hour_start(event_time)
        date_start = get_date_start(event_time)

        cleaned_data["event_time"] = event_time
        cleaned_data["hour_start"] = hour_start
        cleaned_data["date_start"] = date_start
        cleaned_data["processed_at"] = datetime.now(timezone.utc)
        cleaned_data["source"] = "stream"

        # ── Store raw transaction ─────────────────────────────────────────
        try:
            transactions_col.insert_one(cleaned_data)
        except PyMongoError as exc:
            log.error("Failed to insert transaction: %s", exc)
            continue  # skip aggregation if the raw write fails

        # ── Update hourly & daily aggregations ────────────────────────────
        metrics_delta = build_metric_delta(cleaned_data)

        try:
            hourly_doc = update_hourly_metrics(hourly_col, hour_start, metrics_delta)
            update_daily_metrics(daily_col, date_start, metrics_delta)
            create_hourly_alerts(alerts_col, hourly_col, hour_start, hourly_doc)
        except PyMongoError as exc:
            log.error("Failed to update metrics: %s", exc)

        # ── Console output ────────────────────────────────────────────────
        record_count += 1
        log.info(
            "[%d]  id=%-6s  cost=%-8.1f  discount=%-5.1f  rating=%d  "
            "shipment=%-6s  warehouse=%s  on_time=%d  hour=%s",
            record_count,
            cleaned_data.get("id", "?"),
            cleaned_data.get("cost_of_product", 0),
            cleaned_data.get("discount_offered", 0),
            cleaned_data.get("customer_rating", 0),
            cleaned_data.get("mode_of_shipment", "?"),
            cleaned_data.get("warehouse_block", "?"),
            cleaned_data.get("reached_on_time", 0),
            hour_start.strftime("%Y-%m-%d %H:00"),
        )

except KeyboardInterrupt:
    log.info("\nStopped by user after %d records.", record_count)
finally:
    db_client.close()
    log.info("MongoDB connection closed.")