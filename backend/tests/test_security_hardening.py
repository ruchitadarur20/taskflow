from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from app.core.rate_limit import RateLimitResult, RateLimitRule, set_rate_limiter
from app.core.settings import Settings

VALID_PASSWORD = "StrongPass123!"


class BlockingRateLimiter:
    def check(self, rule: RateLimitRule, identifier: str) -> RateLimitResult:
        return RateLimitResult(allowed=False, retry_after_seconds=42, remaining=0)


class FailingRateLimiter:
    def check(self, rule: RateLimitRule, identifier: str) -> RateLimitResult:
        raise RuntimeError("redis secret details")


def test_security_headers_are_returned(client: TestClient) -> None:
    response = client.get("/health/live")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Content-Security-Policy"] == "frame-ancestors 'none'"


def test_production_settings_reject_localhost_only_cors() -> None:
    with pytest.raises(ValidationError):
        Settings(
            taskflow_env="production",
            jwt_secret_key="production-secret-with-at-least-thirty-two-chars",
            cors_allowed_origins=["http://localhost:5173"],
            trusted_hosts=["api.taskflow.example"],
        )


def test_production_settings_reject_wildcard_trusted_hosts() -> None:
    with pytest.raises(ValidationError):
        Settings(
            taskflow_env="production",
            jwt_secret_key="production-secret-with-at-least-thirty-two-chars",
            cors_allowed_origins=["https://taskflow.example"],
            trusted_hosts=["*"],
        )


def test_production_settings_reject_sqlite_database_url() -> None:
    with pytest.raises(ValidationError):
        Settings(
            taskflow_env="production",
            jwt_secret_key="production-secret-with-at-least-thirty-two-chars",
            cors_allowed_origins=["https://taskflow.example"],
            trusted_hosts=["api.taskflow.example"],
            database_url="sqlite+pysqlite:///./taskflow.db",
            redis_url="redis://redis.internal:6379/0",
        )


def test_rate_limit_windows_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        Settings(
            jwt_secret_key="development-secret-with-at-least-thirty-two-chars",
            login_rate_limit_window_seconds=0,
        )


def test_csv_settings_are_supported() -> None:
    settings = Settings.model_validate(
        {
            "jwt_secret_key": "development-secret-with-at-least-thirty-two-chars",
            "cors_allowed_origins": "https://app.example, https://admin.example",
            "trusted_hosts": "api.example,localhost",
        }
    )

    assert settings.cors_allowed_origins == ["https://app.example", "https://admin.example"]
    assert settings.trusted_hosts == ["api.example", "localhost"]


def test_auth_rate_limit_returns_429(client: TestClient) -> None:
    set_rate_limiter(BlockingRateLimiter())

    response = client.post(
        "/auth/login",
        json={"email": "ada@example.com", "password": "wrong"},
    )

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    assert response.headers["Retry-After"] == "42"


def test_rate_limiter_failure_fails_open_by_default(client: TestClient) -> None:
    set_rate_limiter(FailingRateLimiter())

    response = client.post(
        "/auth/login",
        json={"email": "ada@example.com", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_websocket_rejects_disallowed_origin(client: TestClient) -> None:
    body = _register(client)

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(
            f"/ws?token={body['access_token']}",
            headers={"Origin": "https://evil.example"},
        ):
            pass

    assert exc_info.value.code == 4403


def test_websocket_rate_limit_rejects_connection(client: TestClient) -> None:
    body = _register(client)
    set_rate_limiter(BlockingRateLimiter())

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/ws?token={body['access_token']}"):
            pass

    assert exc_info.value.code == 4408


def _register(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/auth/register",
        json={
            "email": "ada@example.com",
            "password": VALID_PASSWORD,
            "display_name": "Ada",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body
