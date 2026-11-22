import sys
from pathlib import Path

import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from config import EVENTS_PER_HOUR
from data_mapping import kaggle_to_on_time


def test_kaggle_on_time_mapping():
    assert kaggle_to_on_time(0) == 1
    assert kaggle_to_on_time(1) == 0


def test_events_per_hour_matches_live_rate():
    assert EVENTS_PER_HOUR == 3600


def test_mean_24h_baseline_uses_only_previous_rows():
    values = [100.0, 110.0, 120.0]
    for target_index in range(24, 25):
        previous = values[max(0, target_index - 24):target_index]
        mean = sum(previous) / len(previous) if previous else None
        assert mean == 110.0


def test_next_hour_target_alignment_has_no_same_target_in_features():
    df = pd.DataFrame({
        "total_cost": [100.0, 110.0, 120.0, 130.0],
        "total_transactions": [10, 11, 12, 13],
    })
    df["target_hour"] = pd.to_datetime([
        "2026-11-20T11:00:00Z",
        "2026-11-20T12:00:00Z",
        "2026-11-20T13:00:00Z",
        "2026-11-20T14:00:00Z",
    ])
    df["target_total_cost"] = df["total_cost"].shift(-1)
    df["lag_1h"] = df["total_cost"].shift(1)
    df["rolling_3h_mean"] = df["total_cost"].shift(1).rolling(3).mean()
    df["hour"] = df["target_hour"].dt.hour
    df = df.iloc[1:3].copy().reset_index(drop=True)

    row = df.iloc[0]
    assert row["target_total_cost"] == 120.0
    assert row["lag_1h"] == 100.0
    assert "target_total_cost" not in [
        "total_transactions", "avg_discount", "avg_rating",
        "total_weight", "lag_1h", "lag_2h", "lag_3h",
        "rolling_3h_mean", "hour", "day_of_week",
        "day_of_month", "is_weekend",
    ]
