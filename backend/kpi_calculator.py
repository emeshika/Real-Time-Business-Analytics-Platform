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
        latest_hour_kpis = {
            "hour_start": latest_hourly["hour_start"], **calculate_kpis(latest_hourly)}
        today_kpis = {
            "date_start": latest_daily["date_start"], **calculate_kpis(latest_daily)}

    if (n_hours is not None) and (n_days is not None):
        n_hours = max(n_hours, 1)  # Ensure at least 1 hour
        n_days = max(n_days, 1)     # Ensure at least 1 day

        # Get all data for trend analysis
        hourly_trends = list(hourly_col.find({"hour_start": {
                             "$ne": latest_hourly["hour_start"]}}).sort("hour_start", 1).limit(n_hours-1))
        daily_trends = list(daily_col.find({"date_start": {
                            "$ne": latest_daily["date_start"]}}).sort("date_start", 1).limit(n_days-1))

        # Calculate trends and add timestamps for plotting
        hourly_kpi_trends = [{"hour_start": h["hour_start"],
                              **calculate_kpis(h)} for h in hourly_trends]
        daily_kpi_trends = [{"date_start": d["date_start"],
                             **calculate_kpis(d)} for d in daily_trends]

    res = {
        "latest_hour_kpis": latest_hour_kpis,
        "today_kpis": today_kpis,
        "hourly_kpi_trends": hourly_kpi_trends,
        "daily_kpi_trends": daily_kpi_trends
    }

    return res


def main():
    # Example usage
    import os
    import sys

    parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.append(parent_dir) if parent_dir not in sys.path else None

    from backend.database import get_collections

    n_hours = 24  # Last 24 hours
    n_days = 7    # Last 7 days
    hourly_trends = []
    daily_trends = []
    latest_hourly_kpis = {}
    latest_daily_kpis = {}

    while True:
        # Get MongoDB collections
        _, _, hourly_col, daily_col = get_collections()

        n_hours = n_hours if len(hourly_trends) == 0 else None
        n_days = n_days if len(daily_trends) == 0 else None

        res = run_analytics_engine(hourly_col, daily_col, n_hours, n_days)

        if latest_hourly_kpis != res["latest_hour_kpis"]:
            hourly_trends = res["hourly_kpi_trends"] if res["hourly_kpi_trends"] else hourly_trends
            daily_trends = res["daily_kpi_trends"] if res["daily_kpi_trends"] else daily_trends

            latest_hourly_kpis = res["latest_hour_kpis"]
            latest_daily_kpis = res["today_kpis"]

            hours = [h["hour_start"] for h in hourly_trends]
            days = [d["date_start"] for d in daily_trends]

            if latest_hourly_kpis["hour_start"] not in hours:
                hourly_trends.append(latest_hourly_kpis)
            else:
                # Update last entry if hour matches
                hourly_trends = hourly_trends[:-1] + [latest_hourly_kpis]

            if latest_daily_kpis["date_start"] not in days:
                daily_trends.append(latest_daily_kpis)
            else:
                # Update last entry if date matches
                daily_trends = daily_trends[:-1] + [latest_daily_kpis]

            if res["hourly_kpi_trends"] == [] and res["daily_kpi_trends"] == []:
                res["hourly_kpi_trends"] = hourly_trends
                res["daily_kpi_trends"] = daily_trends

            print(f"\n{res}\n")


if __name__ == "__main__":
    main()
