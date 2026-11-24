"""
forecast_engine.py  —  Phase 3
Team 03 | PulseBI Project

Loads the trained model, reads the latest hourly_metrics from MongoDB and
predicts total_cost for the hour AFTER the latest COMPLETE hour.

* Partial hours (the hour still in progress) are never used as input.
* One prediction per target hour (upsert), so the log has no duplicates.
* If duplicates already exist they are cleaned up instead of crashing.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

import joblib
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv()

from config import MIN_COMPLETE_EVENTS  # noqa: E402
from analytics_ml.features import add_features, prepare_hourly  # noqa: E402

MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models", "sales_model.pkl"
)
MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
INTERVAL_SECONDS = 30
HOURS_TO_LOAD = 60


def iso(ts):
    return pd.Timestamp(ts).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


# ─────────────────────────────────────────────────────────────────
# 1. Load the trained model
# ─────────────────────────────────────────────────────────────────
print("\n" + "=" * 55)
print("  PulseBI — forecast_engine.py  |  Phase 3")
print("=" * 55)
print("\n[1/3] Loading trained model...")

if not os.path.exists(MODEL_PATH):
    print(f"\n  ERROR: No model file found at:\n         {MODEL_PATH}")
    print("\n  Fix: python analytics_ml/train_model.py\n")
    sys.exit(1)

saved = joblib.load(MODEL_PATH)
model = saved["model"]
FEATURES = saved["features"]

print("      ✓ Model loaded.")
print(f"      Trained at       : {saved.get('trained_at', 'unknown')}")
print(f"      Features used    : {FEATURES}")

# ─────────────────────────────────────────────────────────────────
# 2. Connect to MongoDB
# ─────────────────────────────────────────────────────────────────
print("\n[2/3] Connecting to MongoDB...")
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[os.getenv("MONGODB_DATABASE", "stream_analytics")]
client.admin.command("ping")
print("      ✓ Connected.")


def dedupe_predictions():
    """Keep only the newest prediction per (target_hour, source)."""
    pipeline = [
        {"$match": {"source": {"$in": ["stream", "backtest"]}}},
        {"$sort": {"saved_at": -1}},
        {"$group": {
            "_id": {"t": "$target_hour", "s": "$source"},
            "keep": {"$first": "$_id"},
            "all": {"$push": "$_id"},
        }},
    ]
    removed = 0
    for group in db.predictions.aggregate(pipeline):
        extra = [doc_id for doc_id in group["all"] if doc_id != group["keep"]]
        if extra:
            removed += db.predictions.delete_many({"_id": {"$in": extra}}).deleted_count
    return removed


def ensure_unique_index():
    spec = dict(
        keys=[("target_hour", 1), ("source", 1)],
        unique=True,
        partialFilterExpression={"source": {"$in": ["stream", "backtest"]}},
    )
    try:
        db.predictions.create_index(spec["keys"], unique=True,
                                    partialFilterExpression=spec["partialFilterExpression"])
    except DuplicateKeyError:
        removed = dedupe_predictions()
        print(f"      Removed {removed} duplicate predictions, retrying index build...")
        try:
            db.predictions.create_index(spec["keys"], unique=True,
                                        partialFilterExpression=spec["partialFilterExpression"])
        except Exception as exc:  # keep running without the index
            print(f"      WARNING: could not create unique index ({exc}). Continuing.")


ensure_unique_index()


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────
def fetch_latest_hourly(n=HOURS_TO_LOAD):
    cursor = db.hourly_metrics.find({}, {"_id": 0}).sort("hour_start", -1).limit(n)
    return list(cursor)


def make_prediction():
    """Return a prediction dict, or a short string explaining why not."""
    docs = fetch_latest_hourly()
    if not docs:
        return "No data in hourly_metrics yet."

    full, stats = prepare_hourly(docs, MIN_COMPLETE_EVENTS)
    frame = add_features(full)

    missing = [c for c in FEATURES if c not in frame.columns]
    if missing:
        raise RuntimeError(f"Model expects features that are not built: {missing}. "
                           "Re-run train_model.py.")

    ready = frame.dropna(subset=FEATURES)
    if ready.empty:
        return ("Waiting for 4 consecutive complete hours "
                f"(complete hours loaded: {stats['complete_hours']}).")

    row = ready.iloc[[-1]]
    based_on = row.index[0]
    target = based_on + pd.Timedelta(hours=1)
    current_hour = pd.Timestamp.now(tz="UTC").floor("h")
    if target < current_hour:
        latest_complete = frame["total_cost"].dropna().index[-1]
        if latest_complete > based_on:
            streak = 0
            for value in reversed(frame["total_cost"].loc[:latest_complete].tolist()):
                if pd.isna(value):
                    break
                streak += 1
            return (f"Stream is running again after a gap: {streak} consecutive complete hour(s) so far. "
                    "4 are needed for the lag features before live predictions resume.")
        return (f"Latest complete hour is {iso(based_on)}, older than the current hour. "
                "The stream looks idle, so no live prediction is made.")

    predicted = max(0.0, float(model.predict(row[FEATURES])[0]))
    return {
        "predicted_total_cost_next_hour": round(predicted, 2),
        "prediction_time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "based_on_latest_hour": iso(based_on),
        "target_hour": iso(target),
        "source": "stream",
        "records_used": stats["complete_hours"],
        "model_version": "xgboost_v1",
        "status": "ok",
    }


def save_prediction(output):
    now = datetime.now(timezone.utc)
    record = {**output, "saved_at": now}
    result = db.predictions.update_one(
        {"target_hour": record["target_hour"], "source": "stream"},
        {"$set": record, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return "new" if result.upserted_id else "updated"


# ─────────────────────────────────────────────────────────────────
# 3. Live loop
# ─────────────────────────────────────────────────────────────────
print("\n[3/3] Starting live prediction loop.")
print(f"      A forecast is refreshed every {INTERVAL_SECONDS} seconds.")
print("      One prediction is stored per target hour.")
print("      Press Ctrl+C to stop.\n")
print("─" * 55)

cycle = 0
try:
    while True:
        cycle += 1
        now_label = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        try:
            result = make_prediction()
            if isinstance(result, str):
                print(f"[{now_label}]  Cycle {cycle}: {result}")
            else:
                print(f"[{now_label}]  Cycle {cycle}:")
                print(json.dumps(result, indent=4))
                state = save_prediction(result)
                print(f"           ✓ Prediction {state} for target hour {result['target_hour']}")
        except Exception as exc:
            print(f"[{now_label}]  ERROR in cycle {cycle}: {exc}")
            print(f"           Will retry in {INTERVAL_SECONDS} seconds...")
        print("─" * 55)
        time.sleep(INTERVAL_SECONDS)
except KeyboardInterrupt:
    print("\n\n  Stopped by user. Goodbye.\n")
