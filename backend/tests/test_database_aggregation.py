import sys
from pathlib import Path
from datetime import datetime, timezone

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from database import build_metric_delta  # noqa: E402
from api_server.db import serialise_doc  # noqa: E402


def test_build_metric_delta():
    cleaned = {
        "cost_of_product": 125.5,
        "discount_offered": 10,
        "reached_on_time": 1,
        "customer_rating": 4,
        "weight_in_gms": 2000,
        "mode_of_shipment": "Road",
        "warehouse_block": "A",
        "gender": "F",
        "product_importance": "High",
    }
    delta = build_metric_delta(cleaned)

    assert delta["total_cost"] == 125.5
    assert delta["discount_sum"] == 10
    assert delta["on_time_sum"] == 1
    assert delta["rating_sum"] == 4
    assert delta["total_weight"] == 2000
    assert delta["mode_of_shipment"] == "Road"


def test_metric_delta_is_derived_only_from_cleaned_csv_fields():
    cleaned = {
        "cost_of_product": 50,
        "discount_offered": 5,
        "reached_on_time": 0,
        "customer_rating": 3,
        "weight_in_gms": 100,
    }
    delta = build_metric_delta(cleaned)
    assert delta["total_cost"] == 50
    assert delta["on_time_sum"] == 0


def test_serialise_doc_converts_datetime_to_z():
    result = serialise_doc({
        "event_time": datetime(2026, 11, 20, 12, 30, tzinfo=timezone.utc),
    })
    assert result["event_time"] == "2026-11-20T12:30:00Z"
