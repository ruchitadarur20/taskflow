# Background Jobs

Milestone 7 adds Celery-based asynchronous and scheduled job processing on top
of the existing domain/service architecture. It intentionally does not add a
production email provider, digests-by-email, analytics, or anything beyond
what's needed to run and observe jobs reliably.

## Architecture

```
Celery Beat (scheduler)
    -> sends taskflow.<job> on its configured interval
Celery worker (app/workers/tasks.py)
    -> thin task function: builds an idempotency key, calls _run_job()
_run_job() (shared orchestration)
    -> claims a JobRun row (app.domains.jobs.service.claim_job_run)
    -> calls the domain-layer work function (app.domains.jobs.service.*)
    -> records success/failure on the JobRun row
    -> structured JSON log line
domain-layer work function
    -> reuses existing services: notifications.service.create_notification,
       auth.service.cleanup_expired_refresh_tokens, etc.
    -> create_notification queues a realtime event the same way any HTTP
       request does - no Celery-specific realtime code exists
```

Celery-specific code is confined to `app/workers/`:

- `celery_app.py` - the `Celery` app instance, broker/backend config, task
  routing, the Beat schedule (built from `Settings`), worker logging setup,
  and the fork-safety hook for SQLAlchemy's connection pool.
- `tasks.py` - one thin task per job. Each task only computes its
  idempotency key and delegates to `_run_job`, which in turn delegates to a
  function in `app.domains.jobs.service`. No business logic lives here.
- `enqueue.py` - the adapter seam a future domain event would use to enqueue
  a job (`enqueue_task(name, kwargs=...)` wraps `celery_app.send_task`) so
  that call site never imports Celery internals or task objects directly.
  Nothing calls it yet - all four Milestone 7 jobs are scheduled scans, not
  triggered by a specific mutation.

The actual job logic lives in `app.domains.jobs.service` (models in
`app.domains.jobs.models`), following the same layering as every other
domain: no Celery imports, plain functions over a `Session`, fully testable
without a worker process.

## Worker Lifecycle

- **Startup**: `celery -A app.workers.celery_app worker` imports
  `app.workers.tasks`, registering all `@celery_app.task` functions; Celery's
  `setup_logging` signal installs the JSON log formatter
  (`app.core.logging.configure_logging`) before the worker starts consuming.
- **Fork safety**: the default prefork pool forks worker child processes
  *after* the parent has already imported (and initialized) the app,
  including SQLAlchemy's engine/connection pool. A forked child must not
  reuse the parent's live DB connections, so `worker_process_init` disposes
  the inherited pool in every child - each child then opens its own
  connections lazily on first use.
- **Execution**: `task_acks_late=True` + `task_reject_on_worker_lost=True`
  mean a task is only acknowledged (removed from the queue) after it
  finishes; if a worker is killed mid-task, the task is requeued rather than
  silently lost.
- **Shutdown**: standard Celery `SIGTERM` handling drains in-flight tasks
  before exiting (`docker compose down` sends `SIGTERM` then `SIGKILL` after
  its stop grace period).

## Broker / Backend

Both the broker (task queue) and result backend are Redis - the same
`REDIS_URL` already used for realtime pub/sub (Milestone 6), unless
`CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` are set to point elsewhere
(`Settings.resolved_celery_broker_url` / `resolved_celery_result_backend`).
Three queues are routed by task name: `default` (diagnostics), `notifications`
(the three scan/digest jobs), `maintenance` (session cleanup) - so a
deployment could later scale or prioritize them independently without
touching task code.

## Jobs Implemented

| Job | Schedule setting | What it does |
| --- | --- | --- |
| `detect_overdue_tasks` | `overdue_scan_interval_minutes` (default 15m) | Notifies each task's assignee once per day that a task is overdue. |
| `send_due_soon_reminders` | `due_soon_reminder_interval_minutes` (default 30m) | Notifies each task's assignee once per day that a task is due within `due_soon_window_hours` (default 24h). |
| `generate_daily_digests` | `digest_interval_hours` (default 24h) | Aggregates the last 24h of `ActivityEvent`s per workspace and sends each workspace owner one summary notification, if there was any activity. |
| `cleanup_expired_sessions` | `session_cleanup_interval_hours` (default 6h) | Hard-deletes `refresh_tokens` rows expired more than `refresh_token_retention_days` (default 30d) ago. |

All four reuse `app.domains.notifications.service.create_notification` for
the notification half of "create notification -> commit -> publish realtime
event" - nothing about that flow is duplicated or reimplemented in a worker.

Two additional tasks exist purely as operational diagnostics, not business
jobs, and are not on any schedule:

- `taskflow.ping` - proves a worker is alive and consuming its queues.
- `taskflow.debug_fail_then_succeed(fail_times=N)` - genuinely raises for the
  first `N` attempts before genuinely succeeding, for demonstrating real
  retry/backoff against a live worker and broker (see Docker Validation
  below). It doesn't fake anything; it's a deliberately-failing task used to
  exercise the retry path on demand.

## Scheduling

Beat's schedule (`app.workers.celery_app.build_beat_schedule`) is built
entirely from `Settings`, so cadence is configurable per environment through
env vars - no code change needed to run overdue scans every 5 minutes in one
deployment and every hour in another:

```
OVERDUE_SCAN_INTERVAL_MINUTES=15
DUE_SOON_REMINDER_INTERVAL_MINUTES=30
DUE_SOON_WINDOW_HOURS=24
DIGEST_INTERVAL_HOURS=24
SESSION_CLEANUP_INTERVAL_HOURS=6
REFRESH_TOKEN_RETENTION_DAYS=30
```

## Retry Strategy

Every scheduled job task is decorated with:

```python
autoretry_for=(OperationalError, DBAPIError, redis.exceptions.RedisError, ConnectionError, TimeoutError),
retry_backoff=True, retry_backoff_max=300, retry_jitter=True, max_retries=5,
```

Only infrastructure failures - a dropped DB connection, a Redis hiccup, a
network timeout - trigger an automatic retry with jittered exponential
backoff (capped at 5 minutes between attempts, 5 attempts total). A bug
(`TypeError`, an unhandled `ValueError`, ...) is deliberately **not** in
`autoretry_for`: it fails immediately, is logged with a full traceback, and
is left for a human to investigate rather than being retried five times and
buried under backoff delay. This is why `debug_fail_then_succeed` raises
`RuntimeError` specifically and lists it in its own narrow `autoretry_for` -
it's the one task designed to exercise the retry path.

**All four scheduled jobs are safe to retry in full**, including a retry that
re-runs the *entire* task body from the top:

- `detect_overdue_tasks` / `send_due_soon_reminders`: re-scanning re-derives
  the same candidate set; each candidate's notification is separately
  guarded by `has_notified_today`, so a retry after a partial failure simply
  skips whatever already got notified before the failure and notifies the
  rest.
- `generate_daily_digests`: same pattern, guarded per (user, workspace, day).
- `cleanup_expired_sessions`: `DELETE ... WHERE expires_at < cutoff` is
  naturally idempotent - a retry just deletes fewer (or zero) additional
  rows.

## Idempotency and Duplicate Protection

Every job run claims a `job_runs` row before doing any work
(`app.domains.jobs.service.claim_job_run`), keyed by an `idempotency_key`
that is unique in the database:

- Scheduled scans use a **time-windowed key**:
  `"<task_name>:<window_start_iso>"`, where `window_start` floors "now" to
  the start of that job's own scheduling interval
  (`app.domains.jobs.scheduling.window_start`). Two triggers landing in the
  same window - a duplicate Beat fire, a manual trigger shortly after a
  scheduled one, workers racing - produce the same key.
- The digest job uses the calendar day as its key
  (`app.domains.jobs.scheduling.day_key`).

`claim_job_run`'s three outcomes:

| Existing row for this key | Outcome |
| --- | --- |
| none | insert and claim it (a concurrent insert loses to the unique constraint and is treated as a duplicate) |
| `status="running"` or `"succeeded"` | **duplicate - skip**, return `None` |
| `status="failed"` | **legitimate retry** - reopen the same row (new `attempt`, cleared `error`), continue |

This is what lets a genuine retry-after-failure proceed while still blocking
a same-window duplicate trigger, without needing to distinguish them any
other way. The one accepted tradeoff: a run stuck in `"running"` after a
worker crash blocks re-runs of that exact window until the next window's key
naturally differs - self-healing within one scheduling interval, not
instantly.

Per-recipient idempotency for the notification-producing jobs is a second,
independent layer on top: `notifications.service.has_notified_today` checks
whether a matching notification (same user, type, and task/workspace) was
already created today, reusing the existing `notifications` table rather
than adding job-specific dedupe state for that part.

## Data Model

New table: `job_runs` (migration `202608260005_create_job_runs_table.py`) -
`id`, `task_name`, `idempotency_key` (unique), `celery_task_id`, `status`
(`running`/`succeeded`/`failed`), `attempt`, `started_at`, `finished_at`,
`error`, `result_summary_json`. This is both the job-execution audit trail
and the duplicate-execution guard described above; no separate
idempotency-only table was needed.

No changes were made to `tasks`, `notifications`, or any other existing
table - the jobs read from and write to them through their existing service
functions.

## Failure Handling and Observability

`_run_job` (in `app/workers/tasks.py`) wraps every job with structured JSON
log lines (`app.core.logging.configure_logging`, installed via Celery's
`setup_logging` signal):

```json
{"level": "INFO", "logger": "app.workers", "message": "job run succeeded",
 "task_name": "detect_overdue_tasks", "task_id": "<celery task id>",
 "retries": 0, "duration_s": 0.284, "result": {"scanned": 2, "notified": 2}}
```

`task_id` (Celery's task UUID) doubles as the correlation ID for tracing one
execution across the "claimed -> ran -> succeeded/failed" log lines and the
corresponding `job_runs` row (`celery_task_id` column). A failure logs the
same fields plus `error` and a full traceback (`exc_info=True`), and records
the same on the `JobRun` row before the original exception is re-raised so
Celery's own retry/failure handling still applies on top.

## Local Development

From `backend`:

```bash
/private/tmp/taskflow-backend-venv/bin/alembic upgrade head
/private/tmp/taskflow-backend-venv/bin/pytest
/private/tmp/taskflow-backend-venv/bin/ruff check .
/private/tmp/taskflow-backend-venv/bin/mypy app tests

# Run a worker and beat against a local Redis (e.g. `docker compose up -d redis`):
celery -A app.workers.celery_app worker --loglevel=info -Q default,notifications,maintenance
celery -A app.workers.celery_app beat --loglevel=info --schedule=/tmp/celerybeat-schedule

# Trigger a job on demand without waiting for its schedule:
celery -A app.workers.celery_app call taskflow.detect_overdue_tasks
celery -A app.workers.celery_app call taskflow.debug_fail_then_succeed --kwargs '{"fail_times": 2}'
```

## Docker

`compose.yaml` adds `worker` and `beat` services (same image as `api`, built
from `backend/Dockerfile`, different command). Beat writes its schedule file
to `/tmp/celerybeat-schedule` since the image's `/app` is owned by root and
the container runs as the non-root `taskflow` user.

```bash
export JWT_SECRET_KEY=local-validation-secret-with-at-least-thirty-two-characters
docker compose up -d --build --wait
docker compose exec api alembic upgrade head

# Worker connects, beat starts, both report healthy:
docker compose ps

# Trigger a job against the live worker/broker:
docker compose exec worker celery -A app.workers.celery_app call taskflow.ping
docker compose exec worker celery -A app.workers.celery_app call taskflow.detect_overdue_tasks
docker compose logs worker --tail 50

# Inspect job-run audit rows:
docker compose exec postgres psql -U taskflow -d taskflow \
  -c "select task_name, idempotency_key, status, attempt from job_runs order by started_at;"

docker compose down
```

## Known Limitations

- No dead-letter queue or alerting on repeated task failure - a task that
  exhausts its retries is logged and recorded as `failed` on its `JobRun`
  row, but nothing pages anyone.
- `cleanup_expired_sessions` only removes `refresh_tokens`; there is no
  broader "session" concept yet to clean up beyond that table.
- No admin UI or API to browse `job_runs` - it's queried directly (`psql`)
  for now.
- Result backend (Redis) stores every task's result with Celery's default
  TTL; there is no explicit result-expiry policy configured yet.
- Digest generation produces one notification per owner; there is still no
  email delivery of any kind (out of scope for this milestone).
