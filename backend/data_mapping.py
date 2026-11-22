"""Shared mappings for Kaggle shipping data."""


def kaggle_to_on_time(kaggle_reached_on_time):
    """Convert Kaggle Reached.on.Time_Y.N to on-time (1) / not-on-time (0).

    Kaggle defines 1 as NOT reached on time, and 0 as reached on time.
    """
    try:
        value = int(kaggle_reached_on_time)
    except (TypeError, ValueError):
        return 0
    return 1 if value == 0 else 0
