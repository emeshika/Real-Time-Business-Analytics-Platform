"""
features.py
-----------
One place for feature engineering, used by BOTH train_model.py and
forecast_engine.py so training and serving can never drift apart.

Forecast task
-------------
For a COMPLETE hour t, predict total_cost of hour t+1.

Rules that keep the evaluation honest
-------------------------------------
* Only complete hours carry data. Partial hours (stream started/stopped
  mid-hour) are blanked out, so they never become a feature, a lag or a target.
* The series is re-indexed to a regular hourly grid. A lag of "1 hour" is
  therefore always exactly one hour, even when some hours are missing.
* Every feature uses information from hour t or earlier. Calendar features
  describe the TARGET hour (t+1), which is known in advance.
* The naive baseline (next hour = this hour) and the 24h-mean baseline use
  the same information the model has.
"""

import numpy as np
import pandas as pd

NUMERIC_COLS = [
    "total_transactions",
    "avg_discount",
    "avg_rating",
    "total_weight",
    "total_cost",
]

FEATURE_NAMES = [
    "total_transactions",
    "avg_discount",
    "avg_rating",
    "total_weight",
    "hour",
    "day_of_week",
    "day_of_month",
    "is_weekend",
    "lag_0h",           # revenue of the latest complete hour (same info the naive baseline uses)
    "lag_1h",
    "lag_2h",
    "lag_3h",
    "rolling_3h_mean",  # mean of the three hours before the latest hour
]

TARGET = "target_total_cost"


def prepare_hourly(docs, min_events):
    """
    Turn hourly_metrics documents into a regular hourly frame (UTC index).

    Hours with fewer than ``min_events`` transactions are treated as
    incomplete and blanked to NaN. Returns (frame, stats).
    """
    df = pd.DataFrame(docs)
    df["timestamp"] = pd.to_datetime(df["hour_start"], utc=True)
    df = (
        df.sort_values("timestamp")
        .drop_duplicates("timestamp", keep="last")
        .set_index("timestamp")
    )

    for col in NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        else:
            df[col] = np.nan

    complete = df["total_transactions"].fillna(0) >= min_events
    df.loc[~complete, NUMERIC_COLS] = np.nan

    full = df[NUMERIC_COLS].asfreq("h")
    stats = {
        "total_hours_in_db": int(len(df)),
        "complete_hours": int(complete.sum()),
        "excluded_incomplete_hours": int((~complete).sum()),
        "missing_hours": int(len(full) - len(df)),
        "min_events_per_complete_hour": int(min_events),
    }
    return full, stats


def add_features(full):
    """Add model features, the target and both baselines to the hourly frame."""
    f = full.copy()
    cost = f["total_cost"]

    f["lag_0h"] = cost
    f["lag_1h"] = cost.shift(1)
    f["lag_2h"] = cost.shift(2)
    f["lag_3h"] = cost.shift(3)
    f["rolling_3h_mean"] = cost.shift(1).rolling(window=3).mean()

    # Baselines, built from information available at the end of hour t.
    f["naive_pred"] = cost
    f["mean24_pred"] = cost.rolling(window=24, min_periods=12).mean()

    target_hours = f.index + pd.Timedelta(hours=1)
    f["target_hour"] = target_hours
    f["hour"] = np.asarray(target_hours.hour)
    f["day_of_week"] = np.asarray(target_hours.dayofweek)
    f["day_of_month"] = np.asarray(target_hours.day)
    f["is_weekend"] = np.asarray(target_hours.dayofweek >= 5, dtype=int)

    f[TARGET] = cost.shift(-1)
    return f


def training_rows(f):
    """Rows where features, target and both baselines are all available."""
    required = FEATURE_NAMES + [TARGET, "naive_pred", "mean24_pred"]
    return f.dropna(subset=required)
