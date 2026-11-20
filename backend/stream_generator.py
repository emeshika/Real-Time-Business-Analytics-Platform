import csv
import json
import time
from datetime import datetime, timezone

def generate_messages(delay_seconds=1.0, loop=True):
    csv_file_path = "data/business_dataset.csv"
    
    while loop:
        with open(csv_file_path, mode='r', encoding='utf-8') as file:
            csv_reader = csv.DictReader(file) 
            for row in csv_reader:
                
                row_clean = {k.strip().lower(): v for k, v in row.items() if k is not None}
                
                
                raw_values = list(row.values())
                first_column_val = raw_values[0] if raw_values else None
                
                
                message = {
                    
                    "id": int(row_clean.get("id") or first_column_val or 0),
                    
                    "warehouse_block": row_clean.get("warehouse_block"),
                    "mode_of_shipment": row_clean.get("mode_of_shipment"),
                    "customer_care_calls": int(row_clean.get("customer_care_calls", 0)) if row_clean.get("customer_care_calls") else None,
                    "customer_rating": int(row_clean.get("customer_rating", 0)) if row_clean.get("customer_rating") else None,
                    
                    
                    "cost_of_product": float(row_clean.get("cost_of_the_product", 0.0)) if row_clean.get("cost_of_the_product") else None,
                    
                    "prior_purchases": int(row_clean.get("prior_purchases", 0)) if row_clean.get("prior_purchases") else None,
                    "product_importance": row_clean.get("product_importance"),
                    "gender": row_clean.get("gender"),
                    "discount_offered": float(row_clean.get("discount_offered", 0.0)) if row_clean.get("discount_offered") else None,
                    "weight_in_gms": float(row_clean.get("weight_in_gms", 0.0)) if row_clean.get("weight_in_gms") else None,
                    
                    
                    "reached_on_time": int(row_clean.get("reached.on.time_y.n", 0)) if row_clean.get("reached.on.time_y.n") else None,
                    
                    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                }
                
                yield message
                time.sleep(delay_seconds)

if __name__ == "__main__":
    print("Starting stream_generator — press Ctrl-C to stop.\n")
    try:
        for msg in generate_messages(delay_seconds=1.0):
            print(json.dumps(msg, indent=2))
    except KeyboardInterrupt:
        print("\nStream generator stopped.")
    except Exception as e:
        print(f"\nAn error occurred: {e}")