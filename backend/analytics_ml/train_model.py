"""
train_model.py  —  Phase 2
Team 03 | PulseBI Project
Fetches real hourly_metrics from MongoDB Atlas,
trains XGBoost to predict total_cost (revenue),
saves model to analytics_ml/models/sales_model.pkl
"""

import os
import pandas as pd
import numpy as np
from pymongo import MongoClient
from dotenv import load_dotenv
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib
import json
import math
from datetime import datetime, timedelta, timezone

try:
    from analytics_ml.metrics import (
        mean_absolute_error as calculate_mae,
        root_mean_squared_error,
        mean_absolute_percentage_error,
    )
except ModuleNotFoundError:
    from metrics import (
        mean_absolute_error as calculate_mae,
        root_mean_squared_error,
        mean_absolute_percentage_error,
    )

load_dotenv()

# ─────────────────────────────────────────────────────────────────
# 1. Connect to MongoDB
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*55)
print("  PulseBI — train_model.py  |  Phase 2")
print("="*55)
print("\n[1/6] Connecting to MongoDB Atlas...")

MONGO_URI = os.getenv(
    "MONGODB_URI",
    "mongodb://localhost:27017"
)
client = MongoClient(MONGO_URI)
db = client["stream_analytics"]
print("      ✓ Connected successfully.")

# ─────────────────────────────────────────────────────────────────
# 2. Fetch all hourly_metrics documents
# ─────────────────────────────────────────────────────────────────
print("\n[2/6] Fetching data from 'hourly_metrics' collection...")

cursor = db.hourly_metrics.find({}, {"_id": 0})
df = pd.DataFrame(list(cursor))

print(f"      Records fetched  : {len(df)}")
print(f"      Columns found    : {list(df.columns)}")

if df.empty:
    print("\n  ERROR: hourly_metrics is empty.")
    print("         Ask Team 02 to run their Kafka pipeline first.")
    exit()

# ─────────────────────────────────────────────────────────────────
# 3. Clean and prepare
# ─────────────────────────────────────────────────────────────────
print("\n[3/6] Cleaning and preparing data...")

# Parse hour_start as the timestamp
df["timestamp"] = pd.to_datetime(df["hour_start"])
df = df.sort_values("timestamp").reset_index(drop=True)

# Drop rows where target value is missing
df = df.dropna(subset=["total_cost"])

# The features we will use — all confirmed to exist in your collection
FEATURE_COLS = [
    "total_transactions",
    "avg_discount",
    "avg_rating",
    "total_weight",
    # on_time_rate intentionally excluded — it is always 1.0 (no variance)
]

# Fill any missing values with column mean
for col in FEATURE_COLS:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df[col] = df[col].fillna(df[col].mean())

print(f"      Clean rows       : {len(df)}")
print(f"      Date range       : {df['timestamp'].min()} → {df['timestamp'].max()}")

# ─────────────────────────────────────────────────────────────────
# 4. Feature engineering — time and lag features
# ─────────────────────────────────────────────────────────────────
print("\n[4/6] Engineering time and lag features...")

# The forecast target is hour t+1. Calendar features describe the target hour.
df["target_hour"] = df["timestamp"].shift(-1)
df["target_total_cost"] = df["total_cost"].shift(-1)

# Features use hour t and earlier only. Every cost-derived feature is shifted.
df["lag_1h"] = df["total_cost"].shift(1)
df["lag_2h"] = df["total_cost"].shift(2)
df["lag_3h"] = df["total_cost"].shift(3)
df["rolling_3h_mean"] = df["total_cost"].shift(1).rolling(window=3).mean()

df["hour"] = df["target_hour"].dt.hour
df["day_of_week"] = df["target_hour"].dt.day_of_week
df["day_of_month"] = df["target_hour"].dt.day
df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

# Drop rows that now have NaN due to lag/rolling
df = df.dropna().reset_index(drop=True)

print(f"      Rows after lag features : {len(df)}")

if len(df) < 5:
    print("\n  WARNING: Very few rows remain after feature engineering.")
    print("           This usually means not enough hourly data exists yet.")
    print("           Ask Team 02 to run their pipeline longer.")
    print("           Continuing anyway for testing purposes...\n")

# ─────────────────────────────────────────────────────────────────
# 5. Train the XGBoost model
# ─────────────────────────────────────────────────────────────────
print("\n[5/6] Training XGBoost Regressor...")

ALL_FEATURES = (
    FEATURE_COLS
    + ["hour", "day_of_week", "day_of_month", "is_weekend"]
    + ["lag_1h", "lag_2h", "lag_3h", "rolling_3h_mean"]
)

# Only keep features that actually exist in df
FINAL_FEATURES = [f for f in ALL_FEATURES if f in df.columns]
TARGET = "target_total_cost"

print(f"      Features used    : {FINAL_FEATURES}")
print(f"      Target variable  : {TARGET}")

X = df[FINAL_FEATURES]
y = df[TARGET]

# Time-ordered split — no shuffling (important for time-series)
split_idx = int(len(df) * 0.8)
X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

print(f"      Training rows    : {len(X_train)}")
print(f"      Testing rows     : {len(X_test)}")

model = XGBRegressor(
    n_estimators=300,
    learning_rate=0.05,
    max_depth=4,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=2,
    random_state=42,
    verbosity=0
)
model.fit(X_train, y_train)

# Evaluate
if len(X_test) > 0:
    y_pred = model.predict(X_test)
    mae    = mean_absolute_error(y_test, y_pred)
    r2     = r2_score(y_test, y_pred)
    rmse   = root_mean_squared_error(y_test, y_pred)
    mape   = mean_absolute_percentage_error(y_test, y_pred)
    baseline_predicted = df.iloc[split_idx:]["total_cost"].tolist()
    baseline_actual = y_test.tolist()
    baseline_mae = calculate_mae(baseline_actual, baseline_predicted)
    baseline_rmse = root_mean_squared_error(baseline_actual, baseline_predicted)
    baseline_mape = mean_absolute_percentage_error(baseline_actual, baseline_predicted)
    mean24_predicted = [
        float(df.iloc[max(0, i - 24):i]["total_cost"].mean())
        for i in range(split_idx, len(df))
        if i > 0
    ]
    mean24_actual = y_test.iloc[-len(mean24_predicted):].tolist()
    mean24_mae = calculate_mae(mean24_actual, mean24_predicted)
    mean24_rmse = root_mean_squared_error(mean24_actual, mean24_predicted)
    mean24_mape = mean_absolute_percentage_error(mean24_actual, mean24_predicted)
    print(f"\n      ── Evaluation Results ──────────────────")
    print(f"      MAE (Mean Absolute Error)  : {mae:,.2f}")
    print(f"      RMSE                       : {rmse:,.2f}")
    print(f"      MAPE                       : {mape:.2f}%")
    print(f"      R² Score                   : {r2:.4f}")
    print(f"      Interpretation: predictions are off by ~{mae:,.0f} on average")
    if r2 > 0.8:
        print(f"      Model quality              : ✓ Good  (R² > 0.8)")
    elif r2 > 0.5:
        print(f"      Model quality              : ~ Fair  (R² > 0.5)")
    else:
        print(f"      Model quality              : ✗ Needs more data")
else:
    rmse = mape = baseline_mae = baseline_rmse = baseline_mape = None
    mean24_mae = mean24_rmse = mean24_mape = None
    r2 = None
    print("      (Skipping evaluation — not enough data for a test split)")

# ─────────────────────────────────────────────────────────────────
# 6. Save the model
# ─────────────────────────────────────────────────────────────────
print("\n[6/6] Saving model...")

MODEL_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "sales_model.pkl")
os.makedirs(MODEL_DIR, exist_ok=True)

# Save model AND feature list together — forecast_engine.py will need both
joblib.dump(
    {
        "model"    : model,
        "features" : FINAL_FEATURES,
        "target"   : TARGET,
        "trained_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "mae"      : float(mae) if len(X_test) > 0 else None,
        "rmse"     : float(rmse) if rmse is not None else None,
        "mape"     : float(mape) if mape is not None else None,
        "r2"       : float(r2) if r2 is not None else None,
    },
    MODEL_PATH
)

trained_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
metrics = {
    "model_name": "xgboost_v1",
    "train_size": len(X_train),
    "test_size": len(X_test),
    "date_range": {
        "start": df["timestamp"].min().isoformat().replace("+00:00", "Z"),
        "end": df["timestamp"].max().isoformat().replace("+00:00", "Z"),
    },
    "trained_at": trained_at,
    "metrics": {
        "model": {
            "mae": float(mae) if len(X_test) > 0 else None,
            "rmse": float(rmse) if rmse is not None else None,
            "mape": float(mape) if mape is not None else None,
            "r2": float(r2) if r2 is not None else None,
        },
        "naive_baseline": {
            "mae": float(baseline_mae) if baseline_mae is not None else None,
            "rmse": float(baseline_rmse) if baseline_rmse is not None else None,
            "mape": float(baseline_mape) if baseline_mape is not None else None,
        },
        "mean_24h": {
            "mae": float(mean24_mae) if mean24_mae is not None else None,
            "rmse": float(mean24_rmse) if mean24_rmse is not None else None,
            "mape": float(mean24_mape) if mean24_mape is not None else None,
        },
    },
}
METRICS_PATH = os.path.join(MODEL_DIR, "metrics.json")
with open(METRICS_PATH, "w", encoding="utf-8") as metrics_file:
    json.dump(metrics, metrics_file, indent=2)

# Create historical walk-forward backtest predictions.
predictions_col = db["predictions"]
predictions_col.delete_many({"source": "backtest"})
backtest_docs = []
backtest_actual = []
backtest_predicted = []
backtest_baseline = []
backtest_mean24 = []
for test_index in range(split_idx, len(df)):
    walk_model = XGBRegressor(
        n_estimators=300,
        learning_rate=0.05,
        max_depth=4,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=2,
        random_state=42,
        verbosity=0,
    )
    feature_index = test_index - 1
    if feature_index < 3:
        continue
    walk_model.fit(X.iloc[:feature_index], y.iloc[:feature_index])
    predicted_cost = max(0.0, float(walk_model.predict(X.iloc[[feature_index]])[0]))
    actual_cost = float(y.iloc[test_index])
    backtest_actual.append(actual_cost)
    backtest_predicted.append(predicted_cost)
    backtest_baseline.append(float(df.iloc[test_index - 1]["total_cost"]))
    mean_start = max(0, test_index - 24)
    backtest_mean24.append(float(df.iloc[mean_start:test_index]["total_cost"].mean()))

    based_on = df.iloc[feature_index]["timestamp"]
    if hasattr(based_on, "tzinfo") and based_on.tzinfo is not None:
        based_on_utc = based_on.tz_convert("UTC") if hasattr(based_on, "tz_convert") else based_on.astimezone(timezone.utc)
    else:
        based_on_utc = based_on.tz_localize("UTC")
    based_on_iso = based_on_utc.isoformat().replace("+00:00", "Z")
    target_hour = pd.to_datetime(df.iloc[feature_index]["target_hour"])
    if target_hour.tzinfo is None:
        target_hour = target_hour.tz_localize("UTC")
    else:
        target_hour = target_hour.tz_convert("UTC")
    target_hour = target_hour.replace(minute=0, second=0, microsecond=0)
    backtest_docs.append({
        "predicted_total_cost_next_hour": round(predicted_cost, 2),
        "prediction_time": based_on_iso,
        "based_on_latest_hour": based_on_iso,
        "target_hour": target_hour.isoformat().replace("+00:00", "Z"),
        "records_used": test_index,
        "model_version": "xgboost_v1",
        "status": "ok",
        "source": "backtest",
        "created_at": based_on_utc,
        "saved_at": datetime.now(timezone.utc),
    })

if backtest_docs:
    predictions_col.insert_many(backtest_docs)

backtest_metrics = {
    "n": len(backtest_docs),
    "model": {
        "mae": calculate_mae(backtest_actual, backtest_predicted) if backtest_actual else None,
        "rmse": root_mean_squared_error(backtest_actual, backtest_predicted) if backtest_actual else None,
        "mape": mean_absolute_percentage_error(backtest_actual, backtest_predicted) if backtest_actual else None,
    },
    "naive_baseline": {
        "mae": calculate_mae(backtest_actual, backtest_baseline) if backtest_actual else None,
        "rmse": root_mean_squared_error(backtest_actual, backtest_baseline) if backtest_actual else None,
        "mape": mean_absolute_percentage_error(backtest_actual, backtest_baseline) if backtest_actual else None,
    },
    "mean_24h": {
        "mae": calculate_mae(backtest_actual, backtest_mean24) if backtest_actual else None,
        "rmse": root_mean_squared_error(backtest_actual, backtest_mean24) if backtest_actual else None,
        "mape": mean_absolute_percentage_error(backtest_actual, backtest_mean24) if backtest_actual else None,
    },
}
with open(METRICS_PATH, "r", encoding="utf-8") as metrics_file:
    metrics = json.load(metrics_file)
metrics["backtest"] = backtest_metrics
with open(METRICS_PATH, "w", encoding="utf-8") as metrics_file:
    json.dump(metrics, metrics_file, indent=2)

print(f"      ✓ Saved to : {MODEL_PATH}")
print("\n" + "="*55)
print("  ✅  train_model.py finished successfully!")
print("      Next → run: python analytics_ml/forecast_engine.py")
print("="*55 + "\n")