from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.domains.auth.models import RefreshToken
from app.domains.jobs import service as jobs_service
from app.domains.jobs.models import JobRun, JobRunStatus
from app.domains.jobs.scheduling import day_key, window_start
from app.domains.notifications.models import Notification
from app.domains.notifications.service import has_notified_today
from app.workers import tasks

VALID_PASSWORD = "StrongPass123!"


def register(client: TestClient, email: str) -> dict[str, object]:
    response = client.post(
        "/auth/register",
        json={"email": email, "password": VALID_PASSWORD, "display_name": email.split("@")[0]},
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def auth_header(user: dict[str, object]) -> dict[str, str]:
    token = user["access_token"]
    assert isinstance(token, str)
    return {"Authorization": f"Bearer {token}"}


def user_id(user: dict[str, object]) -> uuid.UUID:
    body = user["user"]
    assert isinstance(body, dict)
    return uuid.UUID(str(body["id"]))


def workspace(client: TestClient, user: dict[str, object], name: str = "Acme") -> dict[str, object]:
    response = client.post("/workspaces", json={"name": name}, headers=auth_header(user))
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def add_member(
    client: TestClient, owner: dict[str, object], workspace_id: str, email: str, role: str
) -> None:
    response = client.post(
        f"/workspaces/{workspace_id}/members",
        json={"email": email, "role": role},
        headers=auth_header(owner),
    )
    assert response.status_code == 201


def project(client: TestClient, actor: dict[str, object], workspace_id: str) -> dict[str, object]:
    response = client.post(
        f"/workspaces/{workspace_id}/projects", json={"name": "Launch"}, headers=auth_header(actor)
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def task(
    client: TestClient,
    actor: dict[str, object],
    workspace_id: str,
    project_id: str,
    **extra: object,
) -> dict[str, object]:
    response = client.post(
        f"/workspaces/{workspace_id}/projects/{project_id}/tasks",
        json={"title": "Ship it", **extra},
        headers=auth_header(actor),
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


# --- Scheduling window helper ---------------------------------------------------


def test_window_start_buckets_same_interval_together() -> None:
    base = datetime(2026, 8, 26, 10, 7, 0, tzinfo=UTC)
    later_same_window = datetime(2026, 8, 26, 10, 12, 59, tzinfo=UTC)
    next_window = datetime(2026, 8, 26, 10, 15, 0, tzinfo=UTC)

    assert window_start(base, 15) == window_start(later_same_window, 15)
    assert window_start(base, 15) != window_start(next_window, 15)


def test_window_start_rejects_non_positive_interval() -> None:
    with pytest.raises(ValueError):
        window_start(datetime.now(tz=UTC), 0)


def test_day_key_is_date_only() -> None:
    assert day_key(datetime(2026, 8, 26, 23, 59, tzinfo=UTC)) == "2026-08-26"


# --- JobRun claim/complete/fail (duplicate-execution guard) --------------------


def test_claim_job_run_first_time_succeeds(db_session: Session) -> None:
    job_run = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:1", celery_task_id="abc", attempt=1
    )
    assert job_run is not None
    assert job_run.status == JobRunStatus.running
    assert job_run.attempt == 1


def test_claim_job_run_rejects_duplicate_while_running(db_session: Session) -> None:
    first = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:2", celery_task_id="a", attempt=1
    )
    assert first is not None

    second = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:2", celery_task_id="b", attempt=1
    )
    assert second is None


def test_claim_job_run_rejects_duplicate_after_success(db_session: Session) -> None:
    first = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:3", celery_task_id="a", attempt=1
    )
    assert first is not None
    jobs_service.complete_job_run(db_session, first.id, result_summary={"ok": True})

    second = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:3", celery_task_id="b", attempt=1
    )
    assert second is None


def test_claim_job_run_allows_retry_after_failure(db_session: Session) -> None:
    first = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:4", celery_task_id="a", attempt=1
    )
    assert first is not None
    jobs_service.fail_job_run(db_session, first.id, error="boom")

    second = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:4", celery_task_id="b", attempt=2
    )
    assert second is not None
    assert second.id == first.id
    assert second.status == JobRunStatus.running
    assert second.attempt == 2

    stored = db_session.get(JobRun, first.id)
    assert stored is not None
    assert stored.error is None


def test_fail_job_run_records_error_and_status(db_session: Session) -> None:
    job_run = jobs_service.claim_job_run(
        db_session, task_name="demo", idempotency_key="demo:5", celery_task_id="a", attempt=1
    )
    assert job_run is not None
    jobs_service.fail_job_run(db_session, job_run.id, error="database is on fire")

    stored = db_session.get(JobRun, job_run.id)
    assert stored is not None
    assert stored.status == JobRunStatus.failed
    assert stored.error == "database is on fire"
    assert stored.finished_at is not None


def test_fail_stale_running_jobs_marks_only_expired_runs_failed(db_session: Session) -> None:
    now = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    stale = JobRun(
        task_name="demo",
        idempotency_key="stale",
        celery_task_id="a",
        status=JobRunStatus.running,
        attempt=1,
        started_at=now - timedelta(minutes=121),
    )
    fresh = JobRun(
        task_name="demo",
        idempotency_key="fresh",
        celery_task_id="b",
        status=JobRunStatus.running,
        attempt=1,
        started_at=now - timedelta(minutes=30),
    )
    db_session.add_all([stale, fresh])
    db_session.commit()

    marked = jobs_service.fail_stale_running_jobs(db_session, timeout_minutes=120, now=now)

    assert marked == 1
    assert stale.status == JobRunStatus.failed
    assert stale.finished_at == now.replace(tzinfo=None)
    assert stale.error == "Marked failed after exceeding stale running-job timeout"
    assert fresh.status == JobRunStatus.running


# --- detect_overdue_tasks --------------------------------------------------


def test_detect_overdue_tasks_notifies_assignee_once_per_day(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "member@example.com", "member")
    proj = project(client, owner, str(ws["id"]))
    yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    created = task(
        client,
        owner,
        str(ws["id"]),
        str(proj["id"]),
        assignee_id=str(user_id(member)),
        due_at=yesterday,
    )

    first_run = jobs_service.detect_overdue_tasks(db_session)
    assert first_run == {"scanned": 1, "notified": 1}

    notifications = list(
        db_session.scalars(
            select(Notification).where(Notification.task_id == uuid.UUID(str(created["id"])))
        )
    )
    assert len(notifications) == 1
    assert notifications[0].type == "task.overdue"

    second_run = jobs_service.detect_overdue_tasks(db_session)
    assert second_run == {"scanned": 1, "notified": 0}


def test_detect_overdue_tasks_skips_done_and_unassigned(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))
    yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    task(client, owner, str(ws["id"]), str(proj["id"]), due_at=yesterday)  # unassigned
    done_task = task(client, owner, str(ws["id"]), str(proj["id"]), due_at=yesterday)
    client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{done_task['id']}",
        json={"status": "done", "assignee_id": str(user_id(owner))},
        headers=auth_header(owner),
    )

    result = jobs_service.detect_overdue_tasks(db_session)
    assert result == {"scanned": 0, "notified": 0}


# --- send_due_soon_reminders ------------------------------------------------


def test_send_due_soon_reminders_only_notifies_within_window(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))
    soon = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    far = (datetime.now(UTC) + timedelta(days=10)).isoformat()
    task(
        client, owner, str(ws["id"]), str(proj["id"]), assignee_id=str(user_id(owner)), due_at=soon
    )
    task(
        client, owner, str(ws["id"]), str(proj["id"]), assignee_id=str(user_id(owner)), due_at=far
    )

    result = jobs_service.send_due_soon_reminders(db_session, window_hours=24)
    assert result == {"scanned": 1, "notified": 1}


# --- generate_daily_digests --------------------------------------------------


def test_generate_daily_digests_notifies_owner_and_is_idempotent(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    project(client, owner, str(ws["id"]))  # produces a project.created activity event

    first_run = jobs_service.generate_daily_digests(db_session)
    assert first_run == {"workspaces_scanned": 1, "digests_sent": 1}

    assert has_notified_today(
        db_session, user_id=user_id(owner), notification_type="workspace.digest",
        workspace_id=uuid.UUID(str(ws["id"])),
    )

    second_run = jobs_service.generate_daily_digests(db_session)
    assert second_run == {"workspaces_scanned": 1, "digests_sent": 0}


def test_generate_daily_digests_skips_workspace_with_no_recent_activity(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    project(client, owner, str(ws["id"]))

    far_future = datetime.now(UTC) + timedelta(days=3)
    result = jobs_service.generate_daily_digests(db_session, now=far_future)
    assert result == {"workspaces_scanned": 1, "digests_sent": 0}


# --- cleanup_expired_sessions ------------------------------------------------


def test_cleanup_expired_sessions_deletes_only_tokens_past_retention(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")

    tokens = list(
        db_session.scalars(select(RefreshToken).where(RefreshToken.user_id == user_id(owner)))
    )
    assert len(tokens) == 1
    stale = tokens[0]
    stale_id = stale.id
    stale.expires_at = datetime.now(UTC) - timedelta(days=40)
    db_session.commit()

    fresh_user = register(client, "fresh@example.com")
    fresh_tokens = list(
        db_session.scalars(select(RefreshToken).where(RefreshToken.user_id == user_id(fresh_user)))
    )
    assert len(fresh_tokens) == 1
    fresh_id = fresh_tokens[0].id

    result = jobs_service.cleanup_expired_sessions(db_session, retention_days=30)
    assert result == {"deleted_refresh_tokens": 1}

    remaining_ids = {row.id for row in db_session.scalars(select(RefreshToken))}
    assert stale_id not in remaining_ids
    assert fresh_id in remaining_ids


# --- Celery task wrappers: diagnostics (no DB) -------------------------------


def test_ping_task_apply_succeeds() -> None:
    result = tasks.ping.apply()
    assert result.state == "SUCCESS"
    assert result.result["pong"] is True


def test_debug_task_retries_until_success() -> None:
    result = tasks.debug_fail_then_succeed.apply(kwargs={"fail_times": 2})
    assert result.state == "SUCCESS"
    assert result.result == {"succeeded_after_retries": 2}


def test_debug_task_fails_after_exhausting_retries() -> None:
    result = tasks.debug_fail_then_succeed.apply(kwargs={"fail_times": 999})
    assert result.state == "FAILURE"
    with pytest.raises(RuntimeError):
        result.get()


# --- Celery task wrappers: real jobs, DB-backed via monkeypatched SessionLocal --


def _bind_worker_sessions_to(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    test_sessionmaker = sessionmaker(
        bind=db_session.get_bind(), autoflush=False, autocommit=False, expire_on_commit=False
    )
    monkeypatch.setattr(tasks, "SessionLocal", test_sessionmaker)


def test_detect_overdue_tasks_task_writes_job_run_and_result(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _bind_worker_sessions_to(monkeypatch, db_session)
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))
    yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    task(
        client, owner, str(ws["id"]), str(proj["id"]), assignee_id=str(user_id(owner)),
        due_at=yesterday,
    )

    result = tasks.detect_overdue_tasks.apply()
    assert result.state == "SUCCESS"
    assert result.result == {"scanned": 1, "notified": 1}

    job_runs = list(
        db_session.scalars(select(JobRun).where(JobRun.task_name == "detect_overdue_tasks"))
    )
    assert len(job_runs) == 1
    assert job_runs[0].status == JobRunStatus.succeeded
    assert job_runs[0].result_summary_json == {"scanned": 1, "notified": 1}


def test_scheduled_task_duplicate_trigger_in_same_window_is_skipped(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _bind_worker_sessions_to(monkeypatch, db_session)

    first_result = tasks.detect_overdue_tasks.apply()
    assert first_result.result == {"scanned": 0, "notified": 0}

    second_result = tasks.detect_overdue_tasks.apply()
    assert second_result.result["skipped"] is True
    assert second_result.result["reason"] == "duplicate"

    job_runs = list(
        db_session.scalars(select(JobRun).where(JobRun.task_name == "detect_overdue_tasks"))
    )
    assert len(job_runs) == 1


def test_task_records_failure_and_reraises_when_work_raises(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _bind_worker_sessions_to(monkeypatch, db_session)

    def _boom(db: Session) -> dict[str, object]:
        raise ValueError("synthetic failure")

    monkeypatch.setattr(jobs_service, "detect_overdue_tasks", _boom)

    result = tasks.detect_overdue_tasks.apply()
    assert result.state == "FAILURE"
    with pytest.raises(ValueError):
        result.get()

    job_runs = list(
        db_session.scalars(select(JobRun).where(JobRun.task_name == "detect_overdue_tasks"))
    )
    assert len(job_runs) == 1
    assert job_runs[0].status == JobRunStatus.failed
    assert "synthetic failure" in (job_runs[0].error or "")
