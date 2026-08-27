from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

import redis.exceptions as redis_exceptions
from celery import Task
from sqlalchemy.exc import DBAPIError, OperationalError

from app.core.settings import get_settings
from app.db.session import SessionLocal
from app.domains.auth.security import utc_now
from app.domains.jobs import service as jobs_service
from app.domains.jobs.scheduling import day_key, window_start
from app.workers.celery_app import celery_app

logger = logging.getLogger("app.workers")

# Only infrastructure hiccups are worth Celery retrying automatically. A bug
# (TypeError, an unguarded IntegrityError, ...) should fail loudly and be
# investigated rather than being retried five times and hidden by backoff.
RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    OperationalError,
    DBAPIError,
    redis_exceptions.RedisError,
    ConnectionError,
    TimeoutError,
)

MAX_RETRIES = 5
RETRY_BACKOFF_MAX_SECONDS = 300


def _run_job(
    task: Task,
    *,
    task_name: str,
    idempotency_key: str,
    work: Callable[[Any], dict[str, Any]],
) -> dict[str, Any]:
    """Shared orchestration for every scheduled job: claim idempotency, run the
    domain-layer work, record a JobRun, and emit one structured log line per
    outcome. Celery tasks below are thin wrappers around this + their own
    `work` callable - no business logic lives in the task functions themselves.
    """
    task_id = task.request.id
    retries = task.request.retries
    start = time.monotonic()
    log_extra = {"task_name": task_name, "task_id": task_id, "retries": retries}

    with SessionLocal() as db:
        job_run = jobs_service.claim_job_run(
            db,
            task_name=task_name,
            idempotency_key=idempotency_key,
            celery_task_id=task_id,
            attempt=retries + 1,
        )
        if job_run is None:
            logger.info(
                "job run skipped: duplicate of an in-progress or completed window",
                extra={**log_extra, "idempotency_key": idempotency_key},
            )
            return {"skipped": True, "reason": "duplicate", "idempotency_key": idempotency_key}
        job_run_id = job_run.id

    try:
        with SessionLocal() as db:
            result = work(db)
    except Exception as exc:  # noqa: BLE001 - re-raised below after recording failure
        duration_s = round(time.monotonic() - start, 3)
        with SessionLocal() as failure_db:
            jobs_service.fail_job_run(failure_db, job_run_id, error=repr(exc))
        logger.warning(
            "job run failed",
            extra={**log_extra, "duration_s": duration_s, "error": repr(exc)},
            exc_info=True,
        )
        raise

    duration_s = round(time.monotonic() - start, 3)
    with SessionLocal() as db:
        jobs_service.complete_job_run(db, job_run_id, result_summary=result)
    logger.info(
        "job run succeeded",
        extra={**log_extra, "duration_s": duration_s, "result": result},
    )
    return result


@celery_app.task(
    bind=True,
    name="taskflow.detect_overdue_tasks",
    autoretry_for=RETRYABLE_EXCEPTIONS,
    retry_backoff=True,
    retry_backoff_max=RETRY_BACKOFF_MAX_SECONDS,
    retry_jitter=True,
    max_retries=MAX_RETRIES,
)
def detect_overdue_tasks(self: Task) -> dict[str, Any]:
    """Safe to retry: only reads tasks and calls create_notification, which is
    itself guarded by a once-per-day-per-task idempotency check."""
    settings = get_settings()
    window = window_start(utc_now(), settings.overdue_scan_interval_minutes)
    key = f"detect_overdue_tasks:{window.isoformat()}"
    return _run_job(
        self,
        task_name="detect_overdue_tasks",
        idempotency_key=key,
        work=lambda db: jobs_service.detect_overdue_tasks(db),
    )


@celery_app.task(
    bind=True,
    name="taskflow.send_due_soon_reminders",
    autoretry_for=RETRYABLE_EXCEPTIONS,
    retry_backoff=True,
    retry_backoff_max=RETRY_BACKOFF_MAX_SECONDS,
    retry_jitter=True,
    max_retries=MAX_RETRIES,
)
def send_due_soon_reminders(self: Task) -> dict[str, Any]:
    """Safe to retry: same idempotency guarantee as detect_overdue_tasks."""
    settings = get_settings()
    window = window_start(utc_now(), settings.due_soon_reminder_interval_minutes)
    key = f"send_due_soon_reminders:{window.isoformat()}"
    return _run_job(
        self,
        task_name="send_due_soon_reminders",
        idempotency_key=key,
        work=lambda db: jobs_service.send_due_soon_reminders(
            db, window_hours=settings.due_soon_window_hours
        ),
    )


@celery_app.task(
    bind=True,
    name="taskflow.generate_daily_digests",
    autoretry_for=RETRYABLE_EXCEPTIONS,
    retry_backoff=True,
    retry_backoff_max=RETRY_BACKOFF_MAX_SECONDS,
    retry_jitter=True,
    max_retries=MAX_RETRIES,
)
def generate_daily_digests(self: Task) -> dict[str, Any]:
    """Safe to retry: idempotency key is the calendar day, and each recipient
    notification is separately guarded by has_notified_today."""
    now = utc_now()
    key = f"generate_daily_digests:{day_key(now)}"
    return _run_job(
        self,
        task_name="generate_daily_digests",
        idempotency_key=key,
        work=lambda db: jobs_service.generate_daily_digests(db),
    )


@celery_app.task(
    bind=True,
    name="taskflow.cleanup_expired_sessions",
    autoretry_for=RETRYABLE_EXCEPTIONS,
    retry_backoff=True,
    retry_backoff_max=RETRY_BACKOFF_MAX_SECONDS,
    retry_jitter=True,
    max_retries=MAX_RETRIES,
)
def cleanup_expired_sessions(self: Task) -> dict[str, Any]:
    """Safe to retry: a DELETE ... WHERE expires_at < cutoff is naturally
    idempotent - re-running it after a partial failure just deletes fewer (or
    zero) additional rows."""
    settings = get_settings()
    window = window_start(utc_now(), settings.session_cleanup_interval_hours * 60)
    key = f"cleanup_expired_sessions:{window.isoformat()}"
    return _run_job(
        self,
        task_name="cleanup_expired_sessions",
        idempotency_key=key,
        work=lambda db: jobs_service.cleanup_expired_sessions(
            db, retention_days=settings.refresh_token_retention_days
        ),
    )


# --- Diagnostics -----------------------------------------------------------
#
# Not scheduled by Beat and not part of the business domain. They exist so
# Docker validation and local development can prove the worker is alive and
# that retry/backoff actually work against the real broker, without needing
# to wait for (or fake) a real scheduled job's conditions.


@celery_app.task(name="taskflow.ping")
def ping() -> dict[str, Any]:
    return {"pong": True, "at": utc_now().isoformat()}


@celery_app.task(
    bind=True,
    name="taskflow.debug_fail_then_succeed",
    autoretry_for=(RuntimeError,),
    retry_backoff=True,
    retry_backoff_max=10,
    retry_jitter=False,
    max_retries=MAX_RETRIES,
)
def debug_fail_then_succeed(self: Task, fail_times: int = 2) -> dict[str, Any]:
    """Diagnostic task: genuinely raises for the first `fail_times` attempts,
    then genuinely succeeds - for demonstrating retry/backoff against a real
    worker and broker (see docs/background-jobs.md). Not used by any schedule
    or domain flow."""
    if self.request.retries < fail_times:
        raise RuntimeError(f"simulated transient failure (attempt {self.request.retries + 1})")
    return {"succeeded_after_retries": self.request.retries}
