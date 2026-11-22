import os


# Default is 3600 because stream_generator sends one CSV row per second.
EVENTS_PER_HOUR = int(os.getenv("EVENTS_PER_HOUR", "3600"))
