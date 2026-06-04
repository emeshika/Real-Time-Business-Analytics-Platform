import json
from kafka import KafkaConsumer

# --------------------------------
# STEP 1: Kafka Configuration
# --------------------------------

BOOTSTRAP_SERVERS = "localhost:9092"
TOPIC_NAME = "live-business-transactions"

# --------------------------------
# STEP 2: Connect to Kafka
# --------------------------------

consumer = KafkaConsumer(
    TOPIC_NAME,
    bootstrap_servers=BOOTSTRAP_SERVERS,
    auto_offset_reset='latest',
    value_deserializer=lambda x: json.loads(x.decode('utf-8'))
)

print("Connected to Kafka")
print(f"Listening to topic: {TOPIC_NAME}")
print("-" * 50)

# --------------------------------
# STEP 3: Data Cleaning
# --------------------------------

def clean_data(data):

    cleaned = data.copy()

    # Missing warehouse block
    if not cleaned.get("warehouse_block"):
        cleaned["warehouse_block"] = "Unknown"

    # Missing shipment mode
    if not cleaned.get("mode_of_shipment"):
        cleaned["mode_of_shipment"] = "Unknown"

    # Fix numeric fields
    numeric_fields = [
        "customer_care_calls",
        "customer_rating",
        "cost_of_product",
        "prior_purchases",
        "discount_offered",
        "weight_in_gms",
        "reached_on_time"
    ]

    for field in numeric_fields:
        if cleaned.get(field) is None:
            cleaned[field] = 0

    # Remove unwanted fields if any
    unwanted_columns = []

    for col in unwanted_columns:
        cleaned.pop(col, None)

    return cleaned

# --------------------------------
# STEP 4: Read Stream
# --------------------------------

for message in consumer:

    raw_data = message.value

    cleaned_data = clean_data(raw_data)

    print("\nCleaned Record")
    print(json.dumps(cleaned_data, indent=4))