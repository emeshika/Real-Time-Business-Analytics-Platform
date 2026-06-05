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


def run_analytics_engine(hourly_col, daily_col, n_hours=None, n_days=None):
    latest_hour_kpis = {}
    today_kpis = {}
    hourly_kpi_trends = []
    daily_kpi_trends = []

    # Get latest hourly, and daily metrics for real-time dashboarding
    latest_hourly = hourly_col.find_one(sort=[("hour_start", -1)])
    latest_daily = daily_col.find_one(sort=[("date_start", -1)])

    if latest_hourly:
        latest_hour_kpis = calculate_kpis(
            latest_hourly) if latest_hourly else {}
        today_kpis = calculate_kpis(latest_daily) if latest_daily else {}

    if (n_hours is not None) and (n_days is not None):
        n_hours = max(n_hours, 1)  # Ensure at least 1 hour
        n_days = max(n_days, 1)     # Ensure at least 1 day

        # Get all data for trend analysis
        hourly_trends = list(hourly_col.find({"hour_start": {
                             "$ne": latest_hourly["hour_start"]}}).sort("hour_start", 1).limit(n_hours-1))
        daily_trends = list(daily_col.find({"date_start": {
                            "$ne": latest_daily["date_start"]}}).sort("date_start", 1).limit(n_days-1))

        # Calculate trends
        hourly_kpi_trends = [calculate_kpis(
            hourly) for hourly in hourly_trends] + [latest_hour_kpis]
        daily_kpi_trends = [calculate_kpis(daily)
                            for daily in daily_trends] + [today_kpis]

    res = {
        "latest_hour_kpis": latest_hour_kpis,
        "today_kpis": today_kpis,
        "hourly_kpi_trends": hourly_kpi_trends,
        "daily_kpi_trends": daily_kpi_trends
    }
