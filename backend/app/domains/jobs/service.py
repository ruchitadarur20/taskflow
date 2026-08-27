from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domains.auth.security import utc_now
from app.domains.auth.service import cleanup_expired_refresh_tokens
from app.domains.jobs.models import JobRun, JobRunStatus
from app.domains.notifications.service import create_notification, has_notified_today
from app.domains.projects.models import ActivityEvent, Task, TaskStatus
from app.domains.workspaces.models import (
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
    WorkspaceStatus,
)

_INACTIVE_TASK_STATUSES = (TaskStatus.done, TaskStatus.archived)


# --- Job run bookkeeping / duplicate-execution guard ---------------------------


def claim_job_run(
    db: Session,
    *,
    task_name: str,
    idempotency_key: str,
    celery_task_id: str | None,
    attempt: int,
) -> JobRun | None:
    """Claim the right to run `idempotency_key`, or return None if it's a duplicate.

    - No existing row: insert one (racing claims are resolved by the unique
      constraint; the loser gets an IntegrityError and reports a duplicate).
    - Existing row still `running` or already `succeeded`: this is a genuine
      duplicate (overlapping trigger, already-done window) - skip.
    - Existing row `failed`: this is a legitimate retry of the same logical
      run - reopen it and continue, rather than silently skipping real work.
    """
    existing = db.scalar(select(JobRun).where(JobRun.idempotency_key == idempotency_key))
    if existing is not None:
        if existing.status in (JobRunStatus.running, JobRunStatus.succeeded):
            return None
        existing.status = JobRunStatus.running
        existing.attempt = attempt
        existing.celery_task_id = celery_task_id
        existing.started_at = utc_now()
        existing.finished_at = None
        existing.error = None
        db.commit()
        db.refresh(existing)
        return existing

    job_run = JobRun(
        task_name=task_name,
        idempotency_key=idempotency_key,
        celery_task_id=celery_task_id,
        status=JobRunStatus.running,
        attempt=attempt,
        started_at=utc_now(),
    )
    db.add(job_run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    db.refresh(job_run)
    return job_run


def complete_job_run(db: Session, job_run_id: uuid.UUID, *, result_summary: dict[str, Any]) -> None:
    job_run = db.get(JobRun, job_run_id)
    if job_run is None:
        return
    job_run.status = JobRunStatus.succeeded
    job_run.finished_at = utc_now()
    job_run.result_summary_json = result_summary
    db.commit()


def fail_job_run(db: Session, job_run_id: uuid.UUID, *, error: str) -> None:
    job_run = db.get(JobRun, job_run_id)
    if job_run is None:
        return
    job_run.status = JobRunStatus.failed
    job_run.finished_at = utc_now()
    job_run.error = error[:4000]
    db.commit()


# --- Scheduled job logic (pure domain functions, no Celery) --------------------
#
# Every job below is safe to retry: it only ever *reads* candidates and then
# calls `create_notification`, which is itself guarded by `has_notified_today`
# - so re-running the same scan after a transient failure (a dropped DB
# connection mid-scan, for example) re-derives the same candidate set and
# simply skips whatever was already notified, rather than double-notifying.


def detect_overdue_tasks(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    reference = now or utc_now()
    candidates = list(
        db.scalars(
            select(Task).where(
                Task.due_at.isnot(None),
                Task.due_at < reference,
                Task.status.notin_(_INACTIVE_TASK_STATUSES),
                Task.archived_at.is_(None),
                Task.assignee_id.isnot(None),
            )
        )
    )
    notified = 0
    for task in candidates:
        assert task.assignee_id is not None
        if has_notified_today(
            db, user_id=task.assignee_id, notification_type="task.overdue", task_id=task.id,
            now=reference,
        ):
            continue
        create_notification(
            db,
            user_id=task.assignee_id,
            workspace_id=task.workspace_id,
            notification_type="task.overdue",
            title=f"Overdue: {task.title}",
            project_id=task.project_id,
            task_id=task.id,
        )
        notified += 1
    db.commit()
    return {"scanned": len(candidates), "notified": notified}


def send_due_soon_reminders(
    db: Session, *, window_hours: int, now: datetime | None = None
) -> dict[str, int]:
    reference = now or utc_now()
    horizon = reference + timedelta(hours=window_hours)
    candidates = list(
        db.scalars(
            select(Task).where(
                Task.due_at.isnot(None),
                Task.due_at >= reference,
                Task.due_at <= horizon,
                Task.status.notin_(_INACTIVE_TASK_STATUSES),
                Task.archived_at.is_(None),
                Task.assignee_id.isnot(None),
            )
        )
    )
    notified = 0
    for task in candidates:
        assert task.assignee_id is not None
        if has_notified_today(
            db, user_id=task.assignee_id, notification_type="task.due_soon", task_id=task.id,
            now=reference,
        ):
            continue
        create_notification(
            db,
            user_id=task.assignee_id,
            workspace_id=task.workspace_id,
            notification_type="task.due_soon",
            title=f"Due soon: {task.title}",
            project_id=task.project_id,
            task_id=task.id,
        )
        notified += 1
    db.commit()
    return {"scanned": len(candidates), "notified": notified}


def _activity_counts(db: Session, workspace_id: uuid.UUID, since: datetime) -> dict[str, int]:
    rows = db.execute(
        select(ActivityEvent.event_type, func.count())
        .where(ActivityEvent.workspace_id == workspace_id, ActivityEvent.created_at >= since)
        .group_by(ActivityEvent.event_type)
    ).all()
    return {event_type: count for event_type, count in rows}


def generate_daily_digests(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Aggregate the last 24h of workspace activity into one notification per
    workspace owner, when there was any activity. This is deliberately the
    entire "digest" - a single summary notification, not an email."""
    reference = now or utc_now()
    since = reference - timedelta(hours=24)
    workspaces = list(
        db.scalars(select(Workspace).where(Workspace.status == WorkspaceStatus.active))
    )
    digests_sent = 0
    for workspace in workspaces:
        counts = _activity_counts(db, workspace.id, since)
        total = sum(counts.values())
        if total == 0:
            continue
        owners = list(
            db.scalars(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == workspace.id,
                    WorkspaceMember.role == WorkspaceRole.owner,
                )
            )
        )
        summary = ", ".join(f"{count} {event_type}" for event_type, count in sorted(counts.items()))
        for owner in owners:
            if has_notified_today(
                db,
                user_id=owner.user_id,
                notification_type="workspace.digest",
                workspace_id=workspace.id,
                now=reference,
            ):
                continue
            create_notification(
                db,
                user_id=owner.user_id,
                workspace_id=workspace.id,
                notification_type="workspace.digest",
                title=f"Daily activity in {workspace.name}",
                body=summary,
                payload={"counts": counts, "total": total},
            )
            digests_sent += 1
    db.commit()
    return {"workspaces_scanned": len(workspaces), "digests_sent": digests_sent}


def cleanup_expired_sessions(
    db: Session, *, retention_days: int, now: datetime | None = None
) -> dict[str, int]:
    deleted = cleanup_expired_refresh_tokens(db, retention_days=retention_days, now=now)
    return {"deleted_refresh_tokens": deleted}
