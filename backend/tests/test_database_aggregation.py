import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from database import build_metric_delta  # noqa: E402


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
