"""Backfill PulseBI history from the real shipping CSV.

No transaction, hourly, daily, or prediction values are invented. Rows are sampled
from the CSV and passed through the same aggregation helpers used by the consumer.
"""

import os
import random
import csv
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

from database import (
    build_metric_delta,
    update_daily_metrics,
    update_hourly_metrics,
)
from data_mapping import kaggle_to_on_time
from config import EVENTS_PER_HOUR

load_dotenv(override=True)

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGODB_DATABASE", "stream_analytics")
CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "business_dataset.csv")
HISTORY_HOURS = 30 * 24


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
        "reached_on_time": kaggle_to_on_time(row["Reached.on.Time_Y.N"]),
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
frame = pd.DataFrame(rows)
frame["Cost_of_the_Product"] = pd.to_numeric(frame["Cost_of_the_Product"])
frame["Discount_offered"] = pd.to_numeric(frame["Discount_offered"])
frame["Customer_rating"] = pd.to_numeric(frame["Customer_rating"])
frame["Weight_in_gms"] = pd.to_numeric(frame["Weight_in_gms"])

sample_rng = np.random.default_rng(42)
latest_transactions = []

for hour_offset in range(HISTORY_HOURS):
    hour_start = history_start + timedelta(hours=hour_offset)
    sampled = frame.iloc[
        sample_rng.integers(0, len(frame), size=EVENTS_PER_HOUR)
    ]

    count = len(sampled)
    on_time_flags = np.array([
        kaggle_to_on_time(value)
        for value in sampled["Reached.on.Time_Y.N"].to_numpy()
    ])
    mode_counts = sampled["Mode_of_Shipment"].value_counts().to_dict()
    warehouse_counts = sampled["Warehouse_block"].value_counts().to_dict()
    gender_counts = sampled["Gender"].value_counts().to_dict()
    importance_counts = sampled["Product_importance"].value_counts().to_dict()

    delta = {
        "total_transactions": count,
        "total_cost": float(sampled["Cost_of_the_Product"].sum()),
        "discount_sum": float(sampled["Discount_offered"].sum()),
        "on_time_sum": int(on_time_flags.sum()),
        "rating_sum": int(sampled["Customer_rating"].sum()),
        "total_weight": float(sampled["Weight_in_gms"].sum()),
        "shipment_mode_counts": mode_counts,
        "warehouse_block_counts": warehouse_counts,
        "gender_counts": gender_counts,
        "product_importance_counts": importance_counts,
    }
    update_hourly_metrics(hourly_col, hour_start, delta, source="seed_csv")
    update_daily_metrics(daily_col, hour_start.replace(hour=0, minute=0, second=0, microsecond=0), delta, source="seed_csv")

    if hour_offset >= HISTORY_HOURS - 1:
        minute = hour_start
        for _, row in sampled.tail(500).iterrows():
            minute = minute + timedelta(milliseconds=1)
            event = csv_row_to_event(row.to_dict(), minute)
            latest_transactions.append(event)

if latest_transactions:
    transactions_col.insert_many(latest_transactions)

print("Seed complete")
print(f"Rows sampled: {HISTORY_HOURS * EVENTS_PER_HOUR}")
print(f"Latest raw transaction rows: {len(latest_transactions)}")
print(f"Hourly documents: {hourly_col.count_documents({})}")
print(f"Daily documents: {daily_col.count_documents({})}")
print("Predictions: backtest predictions are created by train_model.py")
client.close()
