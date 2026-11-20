"""Shared forecasting metric helpers.

Keep these functions pure so they can be unit-tested without MongoDB or XGBoost.
"""

import math


def mean_absolute_error(actual, predicted):
    pairs = [(float(a), float(p)) for a, p in zip(actual, predicted)]
    return sum(abs(a - p) for a, p in pairs) / len(pairs) if pairs else None


def root_mean_squared_error(actual, predicted):
    pairs = [(float(a), float(p)) for a, p in zip(actual, predicted)]
    if not pairs:
        return None
    return math.sqrt(sum((a - p) ** 2 for a, p in pairs) / len(pairs))


def mean_absolute_percentage_error(actual, predicted):
    pairs = [
        (float(a), float(p))
        for a, p in zip(actual, predicted)
        if float(a) != 0
    ]
    if not pairs:
        return None
    return sum(abs((a - p) / a) for a, p in pairs) / len(pairs) * 100


def naive_baseline(actual):
    """Return next-hour = previous-hour predictions."""
    values = [float(v) for v in actual]
    if not values:
        return [], []
    return values[:-1], values[1:]
