from __future__ import annotations

from datetime import UTC, datetime


def window_start(now: datetime, interval_minutes: int) -> datetime:
    """Floor `now` to the start of its `interval_minutes`-wide UTC window.

    Used to build a time-boxed idempotency key for a periodic job: as long as
    two executions fall in the same window they produce the same key, so the
    `job_runs.idempotency_key` unique constraint collapses them into one
    logical run - covering a duplicate Beat trigger, a manual re-run shortly
    after a scheduled one, or workers racing on the same schedule.
    """
    if interval_minutes <= 0:
        raise ValueError("interval_minutes must be positive")
    epoch_minutes = int(now.astimezone(UTC).timestamp() // 60)
    window_epoch_minutes = (epoch_minutes // interval_minutes) * interval_minutes
    return datetime.fromtimestamp(window_epoch_minutes * 60, tz=UTC)


def day_key(now: datetime) -> str:
    return now.astimezone(UTC).date().isoformat()
