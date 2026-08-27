from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class JobRunStatus(StrEnum):
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class JobRun(Base):
    """One row per attempted execution of a background job.

    Doubles as the duplicate-execution guard: `idempotency_key` is unique, so a
    second attempt to claim the same logical run (a duplicate Beat trigger, an
    overlapping scan, two workers racing) fails to insert and is treated as a
    no-op rather than doing the work twice. See
    `app.domains.jobs.service.claim_job_run`.
    """

    __tablename__ = "job_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[JobRunStatus] = mapped_column(
        Enum(JobRunStatus, name="job_run_status"), nullable=False, default=JobRunStatus.running
    )
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    result_summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
