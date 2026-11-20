import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from stream_generator import generate_messages  # noqa: E402


def test_stream_generator_yields_expected_csv_fields(monkeypatch):
    monkeypatch.chdir(BACKEND_DIR)
    monkeypatch.setattr("stream_generator.time.sleep", lambda _: None)

    message = next(generate_messages(delay_seconds=0, loop=True))
    expected = {
        "id",
        "warehouse_block",
        "mode_of_shipment",
        "customer_rating",
        "cost_of_product",
        "discount_offered",
        "weight_in_gms",
        "reached_on_time",
        "timestamp",
    }
    assert expected.issubset(message)
