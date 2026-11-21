"""Backfill PulseBI history from the real shipping CSV.

No transaction, hourly, daily, or prediction values are invented. Rows are sampled
from the CSV and passed through the same aggregation helpers used by the consumer.
"""

import csv
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

from database import (
    build_metric_delta,
    update_daily_metrics,
    update_hourly_metrics,
)

load_dotenv(override=True)

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGODB_DATABASE", "stream_analytics")
CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "business_dataset.csv")
HISTORY_HOURS = 30 * 24
ROWS_PER_HOUR = 15


def utc_iso(value):
    """Return an aware UTC datetime as ISO 8601 with Z."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def read_csv_rows():
    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as csv_file:
        return list(csv.DictReader(csv_file))


def csv_row_to_event(row, event_time):
    """Convert one CSV row to the same cleaned event shape as the live stream."""
    event = {
        "id": int(row["ID"]),
        "source": "seed_csv",
        "warehouse_block": row["Warehouse_block"],
        "mode_of_shipment": row["Mode_of_Shipment"],
        "customer_care_calls": int(row["Customer_care_calls"]),
        "customer_rating": int(row["Customer_rating"]),
        "cost_of_product": float(row["Cost_of_the_Product"]),
        "prior_purchases": int(row["Prior_purchases"]),
        "product_importance": row["Product_importance"],
        "gender": row["Gender"],
        "discount_offered": float(row["Discount_offered"]),
        "weight_in_gms": float(row["Weight_in_gms"]),
        "reached_on_time": int(row["Reached.on.Time_Y.N"]),
        "timestamp": utc_iso(event_time),
    }
    event["event_time"] = event_time
    event["processed_at"] = event_time
    event["hour_start"] = event_time.replace(minute=0, second=0, microsecond=0)
    event["date_start"] = event_time.replace(hour=0, minute=0, second=0, microsecond=0)
    return event


client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
try:
    client.admin.command("ping")
except Exception as exc:
    raise SystemExit(f"MongoDB connection failed: {exc}")

db = client[DB_NAME]
transactions_col = db["transactions"]
hourly_col = db["hourly_metrics"]
daily_col = db["daily_metrics"]
predictions_col = db["predictions"]

transactions_col.drop()
hourly_col.drop()
daily_col.drop()
predictions_col.drop()

rows = read_csv_rows()
if not rows:
    raise SystemExit("CSV has no data rows")

now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
history_start = now - timedelta(hours=HISTORY_HOURS)
sample_count = HISTORY_HOURS * ROWS_PER_HOUR

transactions = []
for offset in range(sample_count):
    row = rows[offset % len(rows)]
    event_time = history_start + timedelta(minutes=4 * offset)
    event = csv_row_to_event(row, event_time)
    transactions.append(event)

    delta = build_metric_delta(event)
    updated_hour = update_hourly_metrics(
        hourly_col,
        event["hour_start"],
        delta,
        source="seed_csv",
    )
    update_daily_metrics(
        daily_col,
        event["date_start"],
        delta,
        source="seed_csv",
    )

if transactions:
    transactions_col.insert_many(transactions)

print("Seed complete")
print(f"Rows sampled: {len(transactions)}")
print(f"Hourly documents: {hourly_col.count_documents({})}")
print(f"Daily documents: {daily_col.count_documents({})}")
print("Predictions: backtest predictions are created by train_model.py")
client.close()
