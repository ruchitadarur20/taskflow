from __future__ import annotations

import logging
from typing import Literal

import redis
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.settings import get_settings
from app.db.session import engine

logger = logging.getLogger("app.health")

router = APIRouter(prefix="/health", tags=["health"])

DependencyStatus = Literal["ok", "error"]


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "ok"}


def check_database() -> DependencyStatus:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return "ok"


def check_redis() -> DependencyStatus:
    client = redis.Redis.from_url(
        get_settings().redis_url,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    try:
        client.ping()
    finally:
        client.close()
    return "ok"


@router.get("/ready")
async def ready() -> JSONResponse:
    database: DependencyStatus = "ok"
    redis_status: DependencyStatus = "ok"

    try:
        database = check_database()
    except Exception:  # noqa: BLE001 - readiness must fail safely without leaking details
        database = "error"
        logger.warning(
            "readiness database check failed",
            extra={"component": "health", "event": "readiness.database_failed"},
            exc_info=True,
        )

    try:
        redis_status = check_redis()
    except Exception:  # noqa: BLE001 - readiness must fail safely without leaking details
        redis_status = "error"
        logger.warning(
            "readiness redis check failed",
            extra={"component": "health", "event": "readiness.redis_failed"},
            exc_info=True,
        )

    is_ready = database == "ok" and redis_status == "ok"
    body = {
        "status": "ready" if is_ready else "not_ready",
        "database": database,
        "redis": redis_status,
    }
    return JSONResponse(
        status_code=status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=body,
    )
