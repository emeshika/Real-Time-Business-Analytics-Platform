import os


# Default is 3600 because stream_generator sends one CSV row per second.
EVENTS_PER_HOUR = int(os.getenv("EVENTS_PER_HOUR", "3600"))

# An hourly bucket counts as "complete" when it holds at least this share of
# the expected events. Hours where the stream started or stopped part-way
# through are partial and must not be used for training or evaluation.
COMPLETE_HOUR_RATIO = float(os.getenv("COMPLETE_HOUR_RATIO", "0.95"))
MIN_COMPLETE_EVENTS = int(EVENTS_PER_HOUR * COMPLETE_HOUR_RATIO)


def is_complete_hour(total_transactions) -> bool:
    """True when an hourly bucket received (almost) all expected events."""
    try:
        return float(total_transactions or 0) >= MIN_COMPLETE_EVENTS
    except (TypeError, ValueError):
        return False
