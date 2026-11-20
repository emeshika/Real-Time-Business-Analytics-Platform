"""
seed_db.py
----------
Standalone script that seeds MongoDB with realistic test data
so you can test the full frontend ↔ API pipeline WITHOUT
needing Kafka or the kafka producer/consumer running.

Run once:
    python seed_db.py

Then start the API:
    uvicorn api_server.server:app --reload --host 0.0.0.0 --port 8000
"""

import os
import random
import math
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv(override=True)

MONGO_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://sandudul_db_user:WMDCHXt2h7ASSmSy@cluster0.apfqidv.mongodb.net/"
)
DB_NAME   = os.getenv("MONGODB_DATABASE", "stream_analytics")

print(f"\n{'='*55}")
print("  PulseBI — MongoDB Seeder")
print(f"{'='*55}")
print(f"\nConnecting to: {MONGO_URI}")

client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
try:
    client.admin.command("ping")
    print("[OK] MongoDB connected.\n")
except Exception as e:
    print(f"\n[ERROR] Cannot connect to MongoDB: {e}")
    print("    Make sure mongod is running on localhost:27017")
    print("    or set MONGODB_URI in backend/.env\n")
    exit(1)

db = client[DB_NAME]

# ── Helpers ────────────────────────────────────────────────────
rng = random.Random(42)

SHIPMENT_MODES  = ["Ship", "Flight", "Road"]
WAREHOUSES      = ["A", "B", "C", "D", "F"]
IMPORTANCES     = ["Low", "Medium", "High"]
GENDERS         = ["M", "F"]

def rand(lo, hi):       return rng.uniform(lo, hi)
def randi(lo, hi):      return rng.randint(lo, hi)
def choice(lst):        return rng.choice(lst)

# ── 1. Transactions (last 500 records) ────────────────────────
print("[1/3] Seeding 'transactions' collection …")
db.transactions.drop()

now = datetime.now(timezone.utc)
transactions = []
for i in range(500):
    ts = now - timedelta(seconds=i * 4)
    mode  = choice(SHIPMENT_MODES)
    block = choice(WAREHOUSES)
    cost  = round(rand(80, 350), 2)
    disc  = round(rand(0, 65), 2)
    rating = randi(1, 5)
    on_time = randi(0, 1)

    transactions.append({
        "id": 10000 + i,
        "source": "seed",
        "warehouse_block": block,
        "mode_of_shipment": mode,
        "customer_care_calls": randi(1, 7),
        "customer_rating": rating,
        "cost_of_product": cost,
        "prior_purchases": randi(2, 8),
        "product_importance": choice(IMPORTANCES),
        "gender": choice(GENDERS),
        "discount_offered": disc,
        "weight_in_gms": round(rand(1000, 7000), 0),
        "reached_on_time": on_time,
        "event_time":    ts,
        "processed_at":  ts,
        "hour_start":    ts.replace(minute=0, second=0, microsecond=0),
        "timestamp":     ts.isoformat(),
    })

db.transactions.insert_many(transactions)
print(f"   [OK] Inserted {len(transactions)} transactions.\n")

# ── 2. Hourly metrics (last 24 hours) ─────────────────────────
print("[2/3] Seeding 'hourly_metrics' collection …")
db.hourly_metrics.drop()

hourly_docs = []
for h in range(24):
    hour_ts = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=(23 - h))
    txns    = randi(25, 80)
    total_cost = round(txns * rand(120, 280), 2)
    disc_sum   = round(rand(200, 900), 2)
    rating_sum = randi(txns * 2, txns * 5)
    on_time    = randi(int(txns * 0.5), int(txns * 0.85))
    weight     = round(txns * rand(2000, 5000), 2)
    mode_counts = {
        "Ship":   randi(8, 35),
        "Flight": randi(5, 25),
        "Road":   randi(3, 18),
    }
    block_counts = {w: randi(3, 20) for w in WAREHOUSES}

    hourly_docs.append({
        "hour_start":          hour_ts,
        "source":              "seed",
        "total_transactions":  txns,
        "total_cost":          total_cost,
        "discount_sum":        disc_sum,
        "avg_discount":        round(disc_sum / txns, 4),
        "rating_sum":          rating_sum,
        "avg_rating":          round(rating_sum / txns, 4),
        "on_time_sum":         on_time,
        "on_time_rate":        round(on_time / txns, 4),
        "total_weight":        weight,
        "shipment_mode_counts": mode_counts,
        "warehouse_block_counts": block_counts,
        "created_at":          hour_ts,
        "updated_at":          now,
    })

db.hourly_metrics.insert_many(hourly_docs)
print(f"   [OK] Inserted {len(hourly_docs)} hourly metric documents.\n")

# ── 3. Daily metrics (last 7 days) ────────────────────────────
print("[3/3] Seeding 'daily_metrics' collection …")
db.daily_metrics.drop()

daily_docs = []
for d in range(7):
    day_ts = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=(6 - d))
    txns   = randi(400, 950)
    total_cost = round(txns * rand(130, 260), 2)
    disc_sum   = round(rand(3000, 15000), 2)
    rating_sum = randi(txns * 2, txns * 5)
    on_time    = randi(int(txns * 0.55), int(txns * 0.82))
    weight     = round(txns * rand(2500, 4500), 2)

    daily_docs.append({
        "date_start":          day_ts,
        "source":              "seed",
        "total_transactions":  txns,
        "total_cost":          total_cost,
        "discount_sum":        disc_sum,
        "avg_discount":        round(disc_sum / txns, 4),
        "rating_sum":          rating_sum,
        "avg_rating":          round(rating_sum / txns, 4),
        "on_time_sum":         on_time,
        "on_time_rate":        round(on_time / txns, 4),
        "total_weight":        weight,
        "created_at":          day_ts,
        "updated_at":          now,
    })

db.daily_metrics.insert_many(daily_docs)
print(f"   [OK] Inserted {len(daily_docs)} daily metric documents.\n")

# ── 4. ML Predictions (last 10) ───────────────────────────────
print("[4/4] Seeding 'predictions' collection …")
db.predictions.drop()

pred_docs = []
base_cost = 12000.0
for p in range(10):
    pred_ts  = now - timedelta(minutes=p * 30)
    variance = rand(-0.15, 0.20)
    cost     = round(base_cost * (1 + variance), 2)
    base_cost = cost

    pred_docs.append({
        "predicted_total_cost_next_hour": cost,
        "prediction_time":  pred_ts,
        "based_on_latest_hour": (pred_ts - timedelta(hours=1)).isoformat(),
        "target_hour": (pred_ts + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0).isoformat(),
        "source": "seed",
        "records_used":    randi(6, 10),
        "model_version":   "xgboost_v1",
        "status":          "ok",
        "created_at":      pred_ts,
        "saved_at":        now,
    })

db.predictions.insert_many(pred_docs)
print(f"   [OK] Inserted {len(pred_docs)} ML prediction documents.\n")

print("─" * 55)
print("[OK] Seeding complete! MongoDB is ready.")
print(f"   Database : {DB_NAME}")
print(f"   Collections seeded:")
print(f"     transactions  : {db.transactions.count_documents({})} docs")
print(f"     hourly_metrics: {db.hourly_metrics.count_documents({})} docs")
print(f"     daily_metrics : {db.daily_metrics.count_documents({})} docs")
print(f"     predictions   : {db.predictions.count_documents({})} docs")
print("\nNext step:")
print("   uvicorn api_server.server:app --reload --host 0.0.0.0 --port 8000")
print("─" * 55 + "\n")
