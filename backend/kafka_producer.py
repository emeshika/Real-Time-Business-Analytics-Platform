"""
kafka_producer.py
------------------
Connects to a locally-running Kafka broker and publishes every message
produced by stream_generator.py to the topic  live-business-transactions.

Prerequisites
------------------
1.  Kafka running locally on localhost:9092  (see README.md for setup steps)
2.  pip install kafka-python

Run:
    python kafka_producer.py
"""

import json
import logging
import sys

from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable

from stream_generator import generate_messages

# ── Configuration ─────────────────────────────────────────────────────────────
KAFKA_BROKER   = "localhost:9092"      # default local Kafka address
TOPIC_NAME     = "live-business-transactions"
DELAY_SECONDS  = 1.0                   # seconds between messages

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def create_producer() -> KafkaProducer:
    """Create and return a KafkaProducer with JSON value serialisation."""
    return KafkaProducer(
        bootstrap_servers=KAFKA_BROKER,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        # Reliability settings
        acks="all",          # wait for all in-sync replicas
        retries=3,
        retry_backoff_ms=500,
    )


def run():
    log.info("Connecting to Kafka at %s …", KAFKA_BROKER)
    try:
        producer = create_producer()
    except NoBrokersAvailable:
        log.error(
            "Cannot reach Kafka on %s — is the broker running?\n"
            "  Start it with:  bin/kafka-server-start.sh config/server.properties",
            KAFKA_BROKER,
        )
        sys.exit(1)

    log.info("Connected ✓  Publishing to topic '%s'  (Ctrl-C to stop)\n", TOPIC_NAME)

    sent_count = 0
    try:
        for message in generate_messages(delay_seconds=DELAY_SECONDS, loop=True):
            future = producer.send(TOPIC_NAME, value=message)
            # Block until the broker confirms receipt (optional — remove for speed)
            record_metadata = future.get(timeout=10)

            sent_count += 1
            log.info(
                "[%d] → partition=%d  offset=%d  id=%s  timestamp=%s",
                sent_count,
                record_metadata.partition,
                record_metadata.offset,
                message["id"],
                message["timestamp"],
            )

    except KeyboardInterrupt:
        log.info("\nStopped by user after %d messages.", sent_count)
    finally:
        producer.flush()
        producer.close()
        log.info("Producer closed cleanly.")


if __name__ == "__main__":
    run()