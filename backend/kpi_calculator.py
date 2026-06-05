from database import get_collections


def calculate_kpis(data):
    """
    Computes business KPIs based on the provided metrics document.
    Works for both hourly and daily documents.
    """
    # Use 1 for division to avoid ZeroDivisionError
    total = data.get("total_transactions", 0) or 1

    return {
        "conversion_rate": (data.get("on_time_sum", 0) / total) * 100,
        "avg_order_value": data.get("total_cost", 0.0) / total,
        "avg_discount": data.get("avg_discount", 0.0),
        "avg_customer_rating": data.get("avg_rating", 0.0),
        "total_revenue": data.get("total_cost", 0.0),
        # On-time rate
        "operational_efficiency": (data.get("on_time_sum", 0) / total),
        "total_volume": total
    }
