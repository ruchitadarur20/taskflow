from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Protocol, cast

import redis
from fastapi import HTTPException, Request, WebSocket, status

from app.core.settings import Settings, get_settings

logger = logging.getLogger("app.security")


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    max_attempts: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    retry_after_seconds: int
    remaining: int


class RateLimiter(Protocol):
    def check(self, rule: RateLimitRule, identifier: str) -> RateLimitResult: ...


class RedisRateLimiter:
    def __init__(self, redis_url: str, *, prefix: str = "taskflow:rate") -> None:
        self._redis_url = redis_url
        self._prefix = prefix
        self._client: redis.Redis | None = None

    def check(self, rule: RateLimitRule, identifier: str) -> RateLimitResult:
        client = self._get_client()
        key = f"{self._prefix}:{rule.name}:{_hash_identifier(identifier)}"
        count = int(cast(int, client.incr(key)))
        if count == 1:
            client.expire(key, rule.window_seconds)
        ttl = int(cast(int, client.ttl(key)))
        retry_after = ttl if ttl > 0 else rule.window_seconds
        remaining = max(rule.max_attempts - count, 0)
        return RateLimitResult(
            allowed=count <= rule.max_attempts,
            retry_after_seconds=retry_after,
            remaining=remaining,
        )

    def _get_client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._redis_url,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
        return self._client


_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RedisRateLimiter(get_settings().redis_url)
    return _limiter


def set_rate_limiter(limiter: RateLimiter | None) -> None:
    global _limiter
    _limiter = limiter


def login_rule(settings: Settings) -> RateLimitRule:
    return RateLimitRule(
        "auth_login", settings.login_rate_limit_max_attempts,
        settings.login_rate_limit_window_seconds,
    )


def register_rule(settings: Settings) -> RateLimitRule:
    return RateLimitRule(
        "auth_register", settings.register_rate_limit_max_attempts,
        settings.register_rate_limit_window_seconds,
    )


def refresh_rule(settings: Settings) -> RateLimitRule:
    return RateLimitRule(
        "auth_refresh", settings.refresh_rate_limit_max_attempts,
        settings.refresh_rate_limit_window_seconds,
    )


def websocket_rule(settings: Settings) -> RateLimitRule:
    return RateLimitRule(
        "websocket_connect", settings.websocket_rate_limit_max_attempts,
        settings.websocket_rate_limit_window_seconds,
    )


def enforce_http_rate_limit(request: Request, rule: RateLimitRule) -> None:
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return
    identifier = client_identifier(request.client.host if request.client else None)
    try:
        result = get_rate_limiter().check(rule, identifier)
    except Exception:  # noqa: BLE001 - auth should remain available if limiter Redis drops
        logger.warning(
            "rate limiter unavailable",
            extra={"component": "security", "event": "rate_limit.unavailable"},
            exc_info=True,
        )
        if settings.rate_limit_fail_open:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Try again"
        ) from None
    if result.allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests",
        headers={"Retry-After": str(result.retry_after_seconds)},
    )


async def websocket_rate_limited(websocket: WebSocket, rule: RateLimitRule) -> bool:
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return False
    identifier = client_identifier(websocket.client.host if websocket.client else None)
    try:
        result = get_rate_limiter().check(rule, identifier)
    except Exception:  # noqa: BLE001 - websocket auth should remain available if limiter drops
        logger.warning(
            "websocket rate limiter unavailable",
            extra={"component": "security", "event": "rate_limit.websocket_unavailable"},
            exc_info=True,
        )
        return not settings.rate_limit_fail_open
    return not result.allowed


def client_identifier(client_host: str | None) -> str:
    return client_host or "unknown"


def _hash_identifier(identifier: str) -> str:
    return hashlib.sha256(identifier.encode("utf-8")).hexdigest()
