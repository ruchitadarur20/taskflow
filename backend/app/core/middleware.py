from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse

from app.core.request_context import (
    REQUEST_ID_HEADER,
    request_id_from_header,
    reset_request_id,
    set_request_id,
)

logger = logging.getLogger("app.requests")


async def request_observability_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = request_id_from_header(request.headers.get(REQUEST_ID_HEADER))
    token = set_request_id(request_id)
    request.state.request_id = request_id
    started = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001 - unexpected errors need a request ID in logs
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.exception(
            "http request failed",
            extra={
                "component": "api",
                "event": "http.request.failed",
                "request_id": request_id,
                "http_method": request.method,
                "http_path": request.url.path,
                "http_route": _route_path(request),
                "status_code": status.HTTP_500_INTERNAL_SERVER_ERROR,
                "duration_ms": duration_ms,
            },
        )
        response = JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error", "request_id": request_id},
        )
    finally:
        reset_request_id(token)

    response.headers[REQUEST_ID_HEADER] = request_id
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    status_code = response.status_code
    log_method = logger.error if status_code >= 500 else logger.info
    log_method(
        "http request completed",
        extra={
            "component": "api",
            "event": "http.request.completed",
            "request_id": request_id,
            "http_method": request.method,
            "http_path": request.url.path,
            "http_route": _route_path(request),
            "status_code": status_code,
            "duration_ms": duration_ms,
        },
    )
    apply_security_headers(response)
    return response


async def security_headers_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    response = await call_next(request)
    apply_security_headers(response)
    return response


def apply_security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Content-Security-Policy", "frame-ancestors 'none'")
    return response


def _route_path(request: Request) -> str | None:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else None
