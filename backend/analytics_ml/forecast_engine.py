"""
forecast_engine.py  —  Phase 3
Team 03 | PulseBI Project
Loads saved model, reads latest live hourly_metrics from MongoDB,
generates predicted total_cost for the next hour,
outputs clean JSON, saves to 'predictions' collection for Team 04.
"""

import os
import json
import time
import pandas as pd
from pymongo import MongoClient
from dotenv import load_dotenv
import joblib
from datetime import datetime, timezone, timedelta

load_dotenv()

MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "models", "sales_model.pkl"
)
MONGO_URI = os.getenv(
    "MONGODB_URI",
    "mongodb://localhost:27017"
)

# ─────────────────────────────────────────────────────────────────
# 1. Load the trained model
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*55)
print("  PulseBI — forecast_engine.py  |  Phase 3")
print("="*55)
print("\n[1/3] Loading trained model...")

if not os.path.exists(MODEL_PATH):
    print(f"\n  ERROR: No model file found at:\n         {MODEL_PATH}")
    print("\n  Fix: Run train_model.py first:")
    print("       python analytics_ml/train_model.py\n")
    exit()

saved    = joblib.load(MODEL_PATH)
model    = saved["model"]
FEATURES = saved["features"]
mae      = saved.get("mae", "N/A")

print(f"      ✓ Model loaded.")
print(f"      Trained at       : {saved.get('trained_at', 'unknown')}")
print(f"      Features used    : {FEATURES}")
print(f"      Training MAE     : {mae}")

# ─────────────────────────────────────────────────────────────────
# 2. Connect to MongoDB
# ─────────────────────────────────────────────────────────────────
print("\n[2/3] Connecting to MongoDB Atlas...")
client = MongoClient(MONGO_URI)
db     = client["stream_analytics"]
print("      ✓ Connected.")
db.predictions.create_index(
    [("target_hour", 1), ("source", 1)],
    unique=True,
    partialFilterExpression={"source": {"$in": ["stream", "backtest"]}},
)

# ─────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────

def fetch_latest_hourly(n=10):
    """Fetch the n most recent documents from hourly_metrics."""
    cursor = (
        db.hourly_metrics
        .find({}, {"_id": 0})
        .sort("hour_start", -1)
        .limit(n)
    )
    docs = list(cursor)
    return docs


def build_feature_row(docs):
    """
    Build a single feature row from the latest hourly documents.
    Matches the exact same feature engineering as train_model.py.
    Returns a one-row DataFrame, or None if not enough data.
    """
    if len(docs) < 3:
        return None, None

    df = pd.DataFrame(docs)
    df["timestamp"] = pd.to_datetime(df["hour_start"])
    df = df.sort_values("timestamp").reset_index(drop=True)

    # Convert all numeric columns properly
    for col in ["total_transactions", "avg_discount", "avg_rating",
                "total_weight", "total_cost"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    latest = df.iloc[-1]
    base_ts = pd.to_datetime(latest["timestamp"])
    if base_ts.tzinfo is None:
        base_ts = base_ts.tz_localize("UTC")
    else:
        base_ts = base_ts.tz_convert("UTC")
    ts = base_ts + pd.Timedelta(hours=1)

    # Build the same features that train_model.py used
    row = {
        "total_transactions" : float(latest.get("total_transactions", 0) or 0),
        "avg_discount"       : float(latest.get("avg_discount", 0) or 0),
        "avg_rating"         : float(latest.get("avg_rating", 0) or 0),
        "total_weight"       : float(latest.get("total_weight", 0) or 0),
        "hour"               : ts.hour,
        "day_of_week"        : ts.day_of_week,
        "day_of_month"       : ts.day,
        "is_weekend"         : int(ts.day_of_week >= 5),
        "lag_1h"             : float(df["total_cost"].iloc[-2]) if len(df) >= 2 and "total_cost" in df.columns else 0.0,
        "lag_2h"             : float(df["total_cost"].iloc[-3]) if len(df) >= 3 and "total_cost" in df.columns else 0.0,
        "lag_3h"             : float(df["total_cost"].iloc[-4]) if len(df) >= 4 and "total_cost" in df.columns else 0.0,
        "rolling_3h_mean"    : float(df["total_cost"].iloc[-4:-1].mean()) if len(df) >= 4 and "total_cost" in df.columns else 0.0,
    }

    # Build DataFrame with only the columns the model expects, in correct order
    feature_df = pd.DataFrame([row])
    for col in FEATURES:
        if col not in feature_df.columns:
            feature_df[col] = 0.0

    return feature_df[FEATURES], latest


def save_prediction_to_db(output_dict):
    """Save the prediction JSON into MongoDB for Team 04's API to read."""
    record = {**output_dict, "saved_at": datetime.now(timezone.utc)}
    result = db.predictions.update_one(
        {"target_hour": record["target_hour"], "source": "stream"},
        {"$set": record},
        upsert=True,
    )
    return str(result.upserted_id or "existing")


# ─────────────────────────────────────────────────────────────────
# 3. Live prediction loop
# ─────────────────────────────────────────────────────────────────
print("\n[3/3] Starting live prediction loop.")
print("      A new forecast is generated every 30 seconds.")
print("      Predictions are saved to the 'predictions' collection.")
print("      Team 04 can read from that collection via their API.")
print("      Press Ctrl+C to stop.\n")
print("─" * 55)

cycle = 0

while True:
    cycle += 1
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    try:
        docs = fetch_latest_hourly(n=10)

        if not docs:
            print(f"[{now}]  Cycle {cycle}: No data in hourly_metrics yet.")
            print(f"           Waiting for Team 02's pipeline to insert data...")

        else:
            features, latest_doc = build_feature_row(docs)

            if features is None:
                print(f"[{now}]  Cycle {cycle}: Only {len(docs)} records found.")
                print(f"           Need at least 3. Waiting for more data...")

            else:
                # Run the prediction
                raw_prediction = model.predict(features)[0]
                predicted_cost = max(0.0, float(raw_prediction))  # never negative

                latest_hour = pd.to_datetime(latest_doc.get("hour_start"))
                if latest_hour.tzinfo is None:
                    latest_hour = latest_hour.tz_localize("UTC")
                else:
                    latest_hour = latest_hour.tz_convert("UTC")
                latest_hour_iso = latest_hour.isoformat().replace("+00:00", "Z")
                target_hour = (latest_hour + timedelta(hours=1)).replace(
                    minute=0, second=0, microsecond=0
                ).isoformat().replace("+00:00", "Z")

                # Clean JSON output — this is what Team 04 will consume
                output = {
                    "predicted_total_cost_next_hour" : round(predicted_cost, 2),
                    "prediction_time"                : datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "based_on_latest_hour"           : latest_hour_iso,
                    "target_hour"                    : target_hour,
                    "source"                         : "stream",
                    "records_used"                   : len(docs),
                    "model_version"                  : "xgboost_v1",
                    "status"                         : "ok",
                }

                # Print to console
                print(f"[{now}]  Cycle {cycle}:")
                print(json.dumps(output, indent=4, default=str))

                # Save to MongoDB
                doc_id = save_prediction_to_db(output)
                print(f"           ✓ Saved to 'predictions' collection. ID: {doc_id}")

    except KeyboardInterrupt:
        print("\n\n  Stopped by user. Goodbye.\n")
        break
    except Exception as e:
        print(f"[{now}]  ERROR in cycle {cycle}: {e}")
        print(f"           Will retry in 30 seconds...")

    print("─" * 55)
    time.sleep(30)