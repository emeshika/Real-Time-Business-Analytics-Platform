import math
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from analytics_ml.metrics import (  # noqa: E402
    mean_absolute_error,
    mean_absolute_percentage_error,
    naive_baseline,
    root_mean_squared_error,
)


def test_metric_helpers_on_small_example():
    actual = [100, 110, 120]
    predicted = [90, 120, 126]

    assert math.isclose(mean_absolute_error(actual, predicted), 8.666666666666666)
    assert math.isclose(root_mean_squared_error(actual, predicted), math.sqrt((100 + 100 + 36) / 3))
    assert math.isclose(mean_absolute_percentage_error(actual, predicted), ((10 / 100) + (10 / 110) + (6 / 120)) / 3 * 100)


def test_naive_baseline():
    predictions, targets = naive_baseline([100, 110, 120])
    assert predictions == [100, 110]
    assert targets == [110, 120]
