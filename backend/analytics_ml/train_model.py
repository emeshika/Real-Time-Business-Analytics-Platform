"""
train_model.py  —  Phase 2
Team 03 | PulseBI Project

Trains an XGBoost model that predicts next-hour revenue (total_cost) from
hourly_metrics in MongoDB, then evaluates it honestly:

  * only COMPLETE hours are used (partial hours are excluded and counted)
  * offline test  : time-ordered 80/20 split
  * backtest      : walk-forward, re-fitting before every test hour
  * baselines     : naive (previous hour) and mean of the last 24 hours

Outputs
  analytics_ml/models/sales_model.pkl
  analytics_ml/models/metrics.json
  'predictions' collection (source="backtest")
"""

import json
import os
import sys
from datetime import datetime, timezone

import joblib
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient
from sklearn.metrics import r2_score
from xgboost import XGBRegressor

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv()

from config import COMPLETE_HOUR_RATIO, EVENTS_PER_HOUR, MIN_COMPLETE_EVENTS  # noqa: E402
from analytics_ml.features import (  # noqa: E402
    FEATURE_NAMES,
    TARGET,
    add_features,
    prepare_hourly,
    training_rows,
)
from analytics_ml.metrics import (  # noqa: E402
    mean_absolute_error,
    mean_absolute_percentage_error,
    root_mean_squared_error,
)

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "sales_model.pkl")
METRICS_PATH = os.path.join(MODEL_DIR, "metrics.json")
MODEL_VERSION = "xgboost_v1"
MIN_TRAIN_ROWS = 30


def new_model():
    return XGBRegressor(
        n_estimators=300,
        learning_rate=0.05,
        max_depth=4,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=2,
        random_state=42,
        verbosity=0,
    )


def score(actual, predicted):
    actual, predicted = list(actual), list(predicted)
    return {
        "mae": mean_absolute_error(actual, predicted),
        "rmse": root_mean_squared_error(actual, predicted),
        "mape": mean_absolute_percentage_error(actual, predicted),
    }


def iso(ts):
    return pd.Timestamp(ts).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_scores(name, s):
    mape = f"{s['mape']:.2f}%" if s["mape"] is not None else "n/a"
    return f"      {name:<14} MAE {s['mae']:>12,.2f}   RMSE {s['rmse']:>12,.2f}   MAPE {mape}"


print("\n" + "=" * 55)
print("  PulseBI — train_model.py  |  Phase 2")
print("=" * 55)

# ─────────────────────────────────────────────────────────────────
# 1. Connect
# ─────────────────────────────────────────────────────────────────
print("\n[1/6] Connecting to MongoDB...")
MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[os.getenv("MONGODB_DATABASE", "stream_analytics")]
client.admin.command("ping")
print("      ✓ Connected.")

# ─────────────────────────────────────────────────────────────────
# 2. Fetch
# ─────────────────────────────────────────────────────────────────
print("\n[2/6] Fetching data from 'hourly_metrics'...")
docs = list(db.hourly_metrics.find({}, {"_id": 0}))
print(f"      Records fetched  : {len(docs)}")
if not docs:
    print("\n  ERROR: hourly_metrics is empty. Run: python seed_db.py")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────
# 3. Keep complete hours only
# ─────────────────────────────────────────────────────────────────
print("\n[3/6] Selecting complete hours...")
full, hour_stats = prepare_hourly(docs, MIN_COMPLETE_EVENTS)
print(f"      Completeness rule      : >= {MIN_COMPLETE_EVENTS} events "
      f"({COMPLETE_HOUR_RATIO:.0%} of {EVENTS_PER_HOUR})")
print(f"      Hours in database      : {hour_stats['total_hours_in_db']}")
print(f"      Complete hours         : {hour_stats['complete_hours']}")
print(f"      Excluded (incomplete)  : {hour_stats['excluded_incomplete_hours']}")
print(f"      Missing hours (gaps)   : {hour_stats['missing_hours']}")

# ─────────────────────────────────────────────────────────────────
# 4. Features
# ─────────────────────────────────────────────────────────────────
print("\n[4/6] Engineering features (target = revenue of the NEXT hour)...")
frame = add_features(full)
rows = training_rows(frame)
n_rows = len(rows)
print(f"      Usable training rows   : {n_rows}")

if n_rows < MIN_TRAIN_ROWS:
    print(f"\n  ERROR: need at least {MIN_TRAIN_ROWS} usable rows, found {n_rows}.")
    print("         Run seed_db.py to backfill history, then train again.")
    sys.exit(1)

X = rows[FEATURE_NAMES]
y = rows[TARGET]

# ─────────────────────────────────────────────────────────────────
# 5. Train + offline evaluation (time-ordered split, no shuffling)
# ─────────────────────────────────────────────────────────────────
print("\n[5/6] Training XGBoost and evaluating...")
split_idx = int(n_rows * 0.8)
X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
print(f"      Features used    : {FEATURE_NAMES}")
print(f"      Training rows    : {len(X_train)}")
print(f"      Testing rows     : {len(X_test)}")

eval_model = new_model()
eval_model.fit(X_train, y_train)
test_pred = eval_model.predict(X_test)

offline = {
    "model": score(y_test, test_pred),
    "naive_baseline": score(y_test, rows["naive_pred"].iloc[split_idx:]),
    "mean_24h": score(y_test, rows["mean24_pred"].iloc[split_idx:]),
}
offline["model"]["r2"] = float(r2_score(y_test, test_pred))

print("\n      ── Offline test (complete hours only) ──")
print(fmt_scores("XGBoost", offline["model"]))
print(fmt_scores("Naive", offline["naive_baseline"]))
print(fmt_scores("Mean 24h", offline["mean_24h"]))
print(f"      R² (model)     : {offline['model']['r2']:.4f}")

# ─────────────────────────────────────────────────────────────────
# 6. Walk-forward backtest + save
# ─────────────────────────────────────────────────────────────────
print("\n[6/6] Walk-forward backtest (re-fitting before every test hour)...")
predictions_col = db["predictions"]
predictions_col.delete_many({"source": "backtest"})

bt_actual, bt_model, bt_naive, bt_mean24, bt_docs = [], [], [], [], []
test_range = range(split_idx, n_rows)
for count, i in enumerate(test_range, start=1):
    # Train only on rows before i. Row j < i has its target (hour t_j + 1h)
    # known no later than the end of hour t_i, so there is no leakage.
    wf_model = new_model()
    wf_model.fit(X.iloc[:i], y.iloc[:i])
    predicted = max(0.0, float(wf_model.predict(X.iloc[[i]])[0]))

    based_on = rows.index[i]
    target_hour = based_on + pd.Timedelta(hours=1)
    bt_actual.append(float(y.iloc[i]))
    bt_model.append(predicted)
    bt_naive.append(float(rows["naive_pred"].iloc[i]))
    bt_mean24.append(float(rows["mean24_pred"].iloc[i]))

    bt_docs.append({
        "predicted_total_cost_next_hour": round(predicted, 2),
        "prediction_time": iso(based_on),
        "based_on_latest_hour": iso(based_on),
        "target_hour": iso(target_hour),
        "records_used": int(i),
        "model_version": MODEL_VERSION,
        "status": "ok",
        "source": "backtest",
        "created_at": based_on.to_pydatetime(),
        "saved_at": datetime.now(timezone.utc),
    })
    if count % 25 == 0 or count == len(test_range):
        print(f"      ... {count}/{len(test_range)} hours")

if bt_docs:
    predictions_col.insert_many(bt_docs)

backtest = {
    "n": len(bt_docs),
    "model": score(bt_actual, bt_model),
    "naive_baseline": score(bt_actual, bt_naive),
    "mean_24h": score(bt_actual, bt_mean24),
}

print("\n      ── Walk-forward backtest ──")
print(fmt_scores("XGBoost", backtest["model"]))
print(fmt_scores("Naive", backtest["naive_baseline"]))
print(fmt_scores("Mean 24h", backtest["mean_24h"]))

model_mae = backtest["model"]["mae"]
for label, key in (("naive", "naive_baseline"), ("mean 24h", "mean_24h")):
    base_mae = backtest[key]["mae"]
    verdict = "better than" if model_mae < base_mae else "NOT better than"
    print(f"      Model MAE is {verdict} the {label} baseline "
          f"({model_mae:,.0f} vs {base_mae:,.0f})")

# Final model for serving: refit on ALL usable rows (evaluation above used
# train-only models, so the reported numbers stay honest).
final_model = new_model()
final_model.fit(X, y)

os.makedirs(MODEL_DIR, exist_ok=True)
trained_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
joblib.dump(
    {
        "model": final_model,
        "features": FEATURE_NAMES,
        "target": TARGET,
        "trained_at": trained_at,
        "mae": offline["model"]["mae"],
        "rmse": offline["model"]["rmse"],
        "mape": offline["model"]["mape"],
        "r2": offline["model"]["r2"],
    },
    MODEL_PATH,
)

metrics = {
    "model_name": MODEL_VERSION,
    "train_size": int(len(X_train)),
    "test_size": int(len(X_test)),
    "date_range": {"start": iso(rows.index.min()), "end": iso(rows.index.max())},
    "trained_at": trained_at,
    "events_per_hour": EVENTS_PER_HOUR,
    "completeness_threshold": MIN_COMPLETE_EVENTS,
    "hours": hour_stats,
    "excluded_hours_count": hour_stats["excluded_incomplete_hours"],
    "metrics": offline,
    "backtest": backtest,
}
with open(METRICS_PATH, "w", encoding="utf-8") as metrics_file:
    json.dump(metrics, metrics_file, indent=2)

print(f"\n      ✓ Model   : {MODEL_PATH}")
print(f"      ✓ Metrics : {METRICS_PATH}")
print("\n" + "=" * 55)
print("  ✅  train_model.py finished successfully!")
print("      Next → run: python analytics_ml/forecast_engine.py")
print("=" * 55 + "\n")
