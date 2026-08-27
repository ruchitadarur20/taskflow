"""create job runs table

Revision ID: 202608260005
Revises: 202608260004
Create Date: 2026-08-26 00:00:05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202608260005"
down_revision: str | None = "202608260004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM("running", "succeeded", "failed", name="job_run_status").create(
        bind, checkfirst=True
    )
    job_run_status = postgresql.ENUM(
        "running", "succeeded", "failed", name="job_run_status", create_type=False
    )

    op.create_table(
        "job_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_name", sa.String(length=120), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False, unique=True),
        sa.Column("celery_task_id", sa.String(length=64), nullable=True),
        sa.Column("status", job_run_status, nullable=False, server_default="running"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "result_summary_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")
        ),
    )
    op.create_index("ix_job_runs_task_name", "job_runs", ["task_name"])


def downgrade() -> None:
    op.drop_index("ix_job_runs_task_name", table_name="job_runs")
    op.drop_table("job_runs")
    sa.Enum(name="job_run_status").drop(op.get_bind(), checkfirst=True)
