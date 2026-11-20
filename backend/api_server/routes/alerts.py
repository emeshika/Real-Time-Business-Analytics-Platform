"""REST endpoint for operational alerts."""

from fastapi import APIRouter, Query

from api_server.db import get_alerts_col, serialise_doc

router = APIRouter(prefix="/api", tags=["Alerts"])


@router.get("/alerts")
def get_alerts(limit: int = Query(default=50, ge=1, le=200)):
    cursor = (
        get_alerts_col()
        .find({}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    alerts = [serialise_doc(doc) for doc in cursor]
    return {"alerts": alerts, "count": len(alerts)}
