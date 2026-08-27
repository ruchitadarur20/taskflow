from __future__ import annotations

from typing import Any

from app.workers.celery_app import celery_app

"""Adapter boundary for enqueueing jobs from application/domain code.

None of the current domain services call this yet - all four Milestone 7 jobs
are scheduled scans, not triggered by a specific mutation - but it's the seam
a future domain event would use (e.g. "workspace invite sent" -> enqueue an
email job) so that call site only ever imports this module, never Celery
itself. Keeping `send_task` (name-based dispatch) rather than importing task
objects directly from `app.workers.tasks` also avoids domain code depending on
worker internals.
"""


def enqueue_task(
    name: str, *, kwargs: dict[str, Any] | None = None, queue: str | None = None
) -> str:
    """Enqueue a job by task name and return its Celery task id.

    `name` must match a task's registered `name=` (see app.workers.tasks).
    """
    async_result = celery_app.send_task(name, kwargs=kwargs or {}, queue=queue)
    return str(async_result.id)
