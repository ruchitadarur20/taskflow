from __future__ import annotations

from celery import Celery
from celery.signals import setup_logging as celery_setup_logging
from celery.signals import worker_process_init

from app.core.logging import configure_logging
from app.core.settings import Settings, get_settings

# Task routing: scan/notification jobs share a "notifications" queue, and
# maintenance jobs their own queue, so a deployment can scale or prioritize
# them independently later without touching task code.
TASK_ROUTES: dict[str, dict[str, str]] = {
    "taskflow.detect_overdue_tasks": {"queue": "notifications"},
    "taskflow.send_due_soon_reminders": {"queue": "notifications"},
    "taskflow.generate_daily_digests": {"queue": "notifications"},
    "taskflow.cleanup_expired_sessions": {"queue": "maintenance"},
}


def build_beat_schedule(settings: Settings) -> dict[str, dict[str, object]]:
    """Beat schedule driven entirely by Settings, so cadence is configurable
    through environment variables without a code change."""
    return {
        "detect-overdue-tasks": {
            "task": "taskflow.detect_overdue_tasks",
            "schedule": settings.overdue_scan_interval_minutes * 60,
        },
        "send-due-soon-reminders": {
            "task": "taskflow.send_due_soon_reminders",
            "schedule": settings.due_soon_reminder_interval_minutes * 60,
        },
        "generate-daily-digests": {
            "task": "taskflow.generate_daily_digests",
            "schedule": settings.digest_interval_hours * 3600,
        },
        "cleanup-expired-sessions": {
            "task": "taskflow.cleanup_expired_sessions",
            "schedule": settings.session_cleanup_interval_hours * 3600,
        },
    }


def create_celery_app() -> Celery:
    settings = get_settings()
    app = Celery("taskflow")
    app.conf.update(
        broker_url=settings.resolved_celery_broker_url,
        result_backend=settings.resolved_celery_result_backend,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        task_default_queue="default",
        task_routes=TASK_ROUTES,
        # Reliability: don't ack until the task body actually finishes, and
        # requeue work a worker was killed mid-task rather than dropping it.
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        beat_schedule=build_beat_schedule(settings),
    )
    app.autodiscover_tasks(["app.workers"])
    return app


celery_app = create_celery_app()


@celery_setup_logging.connect
def _configure_worker_logging(**kwargs: object) -> None:
    configure_logging()


@worker_process_init.connect
def _dispose_db_engine_on_fork(**kwargs: object) -> None:
    """The prefork pool forks worker child processes after the parent has
    already imported (and thus initialized) the SQLAlchemy engine. Forked
    children must not reuse the parent's live connections/sockets, so each
    child disposes the inherited pool on startup and lazily opens its own."""
    from app.db.session import engine

    engine.dispose()
    _mark_stale_running_jobs()


def _mark_stale_running_jobs() -> None:
    from app.db.session import SessionLocal
    from app.domains.jobs.service import fail_stale_running_jobs

    settings = get_settings()
    with SessionLocal() as db:
        stale_count = fail_stale_running_jobs(
            db, timeout_minutes=settings.stale_job_timeout_minutes
        )
    if stale_count:
        import logging

        logging.getLogger("app.workers").warning(
            "stale job runs marked failed",
            extra={
                "component": "worker",
                "event": "job_runs.stale_failed",
                "result": {"stale_count": stale_count},
            },
        )
