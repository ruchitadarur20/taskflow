from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import redis

from app.core.settings import Settings

logger = logging.getLogger("app.auth")

_TICKET_PREFIX = "taskflow:ws-ticket"


class WebSocketTicketError(Exception):
    """Raised when the one-time WebSocket ticket store is unavailable."""


def issue_websocket_ticket(user_id: uuid.UUID, settings: Settings) -> tuple[str, datetime]:
    ticket = secrets.token_urlsafe(32)
    expires_at = datetime.now(tz=UTC) + timedelta(seconds=settings.websocket_ticket_ttl_seconds)
    client = redis.Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    try:
        created = client.set(
            _ticket_key(ticket),
            str(user_id),
            ex=settings.websocket_ticket_ttl_seconds,
            nx=True,
        )
    except Exception as exc:  # noqa: BLE001 - callers translate to a generic service error
        logger.warning(
            "WebSocket ticket issue failed",
            extra={"component": "auth", "event": "websocket_ticket.issue_failed"},
        )
        raise WebSocketTicketError("WebSocket ticket store unavailable") from exc
    finally:
        client.close()

    if not created:
        raise WebSocketTicketError("WebSocket ticket collision")
    return ticket, expires_at


def consume_websocket_ticket(ticket: str, settings: Settings) -> uuid.UUID | None:
    if len(ticket) < 32 or len(ticket) > 256:
        return None

    client = redis.Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    try:
        value = client.getdel(_ticket_key(ticket))
    except Exception as exc:  # noqa: BLE001 - connection auth must fail closed
        logger.warning(
            "WebSocket ticket consume failed",
            extra={"component": "auth", "event": "websocket_ticket.consume_failed"},
        )
        raise WebSocketTicketError("WebSocket ticket store unavailable") from exc
    finally:
        client.close()

    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def _ticket_key(ticket: str) -> str:
    digest = hashlib.sha256(ticket.encode("utf-8")).hexdigest()
    return f"{_TICKET_PREFIX}:{digest}"
