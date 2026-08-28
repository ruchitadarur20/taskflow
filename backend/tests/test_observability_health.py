from __future__ import annotations

import logging
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.api import health
from app.core.request_context import REQUEST_ID_HEADER
from app.main import app


def test_liveness_returns_success(client: TestClient) -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers[REQUEST_ID_HEADER]


def test_request_id_generated_when_missing(client: TestClient) -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER]


def test_incoming_safe_request_id_is_preserved(client: TestClient) -> None:
    response = client.get("/health/live", headers={REQUEST_ID_HEADER: "req-123_ABC/trace.1"})

    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER] == "req-123_ABC/trace.1"


def test_invalid_incoming_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health/live", headers={REQUEST_ID_HEADER: "not a safe id"})

    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER]
    assert response.headers[REQUEST_ID_HEADER] != "not a safe id"


def test_request_ids_are_not_reused_across_requests(client: TestClient) -> None:
    first = client.get("/health/live")
    second = client.get("/health/live")

    assert first.headers[REQUEST_ID_HEADER] != second.headers[REQUEST_ID_HEADER]


def test_request_logs_include_request_metadata(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="app.requests")

    response = client.get("/health/live", headers={REQUEST_ID_HEADER: "req-log-1"})

    assert response.status_code == 200
    records = [
        record
        for record in caplog.records
        if record.name == "app.requests"
        and getattr(record, "event", None) == "http.request.completed"
    ]
    assert records
    record = cast(Any, records[-1])
    assert record.request_id == "req-log-1"
    assert record.http_method == "GET"
    assert record.http_path == "/health/live"
    assert record.http_route == "/health/live"
    assert record.status_code == 200
    assert isinstance(record.duration_ms, float)


def test_unexpected_errors_are_logged_without_leaking_details(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    route_path = "/__test_observability_error"

    if not any(getattr(route, "path", None) == route_path for route in app.routes):

        @app.get(route_path)
        def _raise_unexpected_error() -> None:
            raise RuntimeError("secret internals")

    caplog.set_level(logging.INFO, logger="app.requests")

    response = client.get(route_path, headers={REQUEST_ID_HEADER: "req-error-1"})

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER] == "req-error-1"
    assert response.json() == {"detail": "Internal server error", "request_id": "req-error-1"}
    assert "secret internals" not in response.text

    failed = [
        record
        for record in caplog.records
        if record.name == "app.requests" and getattr(record, "event", None) == "http.request.failed"
    ]
    assert failed
    failed_record = cast(Any, failed[-1])
    assert failed_record.request_id == "req-error-1"
    assert failed_record.http_method == "GET"
    assert failed_record.http_path == route_path
    assert failed_record.status_code == 500
    assert failed[-1].exc_info


def test_readiness_returns_success_when_dependencies_are_healthy(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_database", lambda: "ok")
    monkeypatch.setattr(health, "check_redis", lambda: "ok")

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok", "redis": "ok"}


def test_readiness_returns_503_when_database_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_database() -> str:
        raise RuntimeError("database host and credentials")

    monkeypatch.setattr(health, "check_database", fail_database)
    monkeypatch.setattr(health, "check_redis", lambda: "ok")

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "database": "error", "redis": "ok"}
    assert "database host and credentials" not in response.text


def test_readiness_returns_503_when_redis_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_redis() -> str:
        raise RuntimeError("redis host and credentials")

    monkeypatch.setattr(health, "check_database", lambda: "ok")
    monkeypatch.setattr(health, "check_redis", fail_redis)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "database": "ok", "redis": "error"}
    assert "redis host and credentials" not in response.text


def test_readiness_returns_503_when_all_dependencies_fail(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_dependency() -> str:
        raise RuntimeError("internal dependency details")

    monkeypatch.setattr(health, "check_database", fail_dependency)
    monkeypatch.setattr(health, "check_redis", fail_dependency)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "database": "error", "redis": "error"}
    assert "internal dependency details" not in response.text
