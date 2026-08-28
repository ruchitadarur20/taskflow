# Testing, Docker, CI/CD, Security, and Observability

## Testing Strategy

Backend tests:

- Unit tests for services, permission policies, token rotation, validators, and domain helpers.
- API tests for auth, RBAC enforcement, core resource workflows, error handling, and pagination.
- Database integration tests with PostgreSQL, migrations, constraints, and transaction behavior.
- Worker tests for Celery task idempotency, retries, and side effects.
- WebSocket tests for authentication, subscription authorization, event delivery, and disconnect behavior.

Frontend tests:

- Unit tests for API client behavior, auth refresh logic, stores, reducers, and utilities.
- Component tests for forms, navigation guards, task interactions, and notification UI.
- Integration tests for authenticated workflows using mocked API and WebSocket events.
- End-to-end smoke tests for login, workspace/project/task basics after app code exists.

Quality gates:

- pytest for backend.
- Type checking for Python and TypeScript.
- Linting and formatting for backend and frontend.
- Migration checks to ensure models and migrations stay aligned.
- Security checks for dependency vulnerabilities and secret leaks.

Current CI runs backend Ruff, mypy, pytest, a backend dependency audit, and a
PostgreSQL migration validation against a clean database. Frontend CI runs
`npm ci`, dependency audit, type checking, unit tests, and production build.

## Docker Strategy

Local development should use Docker Compose to orchestrate:

- PostgreSQL.
- Redis.
- FastAPI backend.
- Celery worker.
- Celery beat scheduler.
- React frontend dev server.

Production images:

- Use slim base images.
- Run as non-root users.
- Install only runtime dependencies in final stages.
- Include health checks for API and worker processes.
- Separate frontend build from static serving.

Environment:

- Keep configuration in environment variables.
- Maintain `.env.example` once runtime configuration exists.
- Never commit real secrets.
- Use different compose overrides for development and test if needed.

Current Docker files are still development-oriented. The backend image runs as a
non-root user. The frontend image uses `npm ci` for lockfile-reproducible
installs, but still serves Vite's development server; production static serving
belongs with Milestone 11 deployment work.

## CI/CD Strategy

GitHub Actions workflow stages:

- Validate repository formatting and linting.
- Run backend type checks and pytest.
- Run frontend type checks and tests.
- Run migration validation.
- Build backend and frontend Docker images.
- Run vulnerability and secret scanning.
- Publish images on protected branches or release tags.
- Deploy through environment-protected jobs requiring approvals for production.

Branch policy:

- Pull requests must pass CI before merge.
- Production deployment should occur from the main branch or tagged releases.
- Database migrations must be reviewed with rollback or forward-fix notes.

## Security Strategy

- Enforce HTTPS in production.
- Use secure cookie settings for refresh tokens.
- Rotate refresh tokens and revoke token families on reuse.
- Hash all stored tokens.
- Rate limit authentication and invitation endpoints.
- Validate and normalize all user input through Pydantic schemas.
- Use parameterized SQLAlchemy queries.
- Apply strict CORS allowlists.
- Enforce RBAC in services and test denied cases.
- Soft-delete or archive collaborative records where auditability matters.
- Keep audit logs immutable from normal application flows.
- Scan dependencies and container images in CI.

## Observability Strategy

Logging:

- Structured JSON logs in production.
- Include request IDs, user IDs where safe, workspace IDs where relevant, and job IDs.
- Avoid logging secrets, tokens, passwords, or sensitive payloads.

Current implementation:

- API requests accept `X-Request-ID` when the incoming value is a safe
  identifier: 1-128 characters using letters, numbers, `.`, `_`, `/`, or `-`.
  Missing or unsafe values are replaced with a generated UUID.
- Every HTTP response includes `X-Request-ID`.
- API request logs are structured JSON and include request ID, method, path,
  matched route, status code, and duration. Request bodies, cookies,
  authorization headers, access tokens, refresh tokens, and passwords are not
  logged.
- Unexpected server errors are logged with the request ID and stack trace, but
  clients receive only a generic `Internal server error` response plus the
  request ID. Stack traces, exception messages, URLs, credentials, and payloads
  are not returned.
- Celery workers use the same JSON formatter for job lifecycle logs.

Metrics:

- Request count, latency, error rate.
- Database query timing and pool saturation.
- Celery queue depth, task duration, retries, failures.
- WebSocket connection counts and fanout errors.

Tracing:

- Use OpenTelemetry-compatible instrumentation.
- Trace API requests, database calls, Redis operations, Celery tasks, and external services.

Health checks:

- Liveness: process is running.
- Readiness: database and Redis dependencies are reachable.
- Version: commit SHA, build time, app version.

Current endpoints:

- `GET /health/live` is lightweight liveness. It returns `200` with
  `{"status": "ok"}` when the API process can answer.
- `GET /health/ready` checks PostgreSQL with `SELECT 1` and Redis with `PING`.
  It returns `200` and `{"status": "ready", "database": "ok", "redis": "ok"}`
  only when both dependencies are reachable.
- If either dependency is unavailable, readiness returns `503` with dependency
  fields set to `error`, for example
  `{"status": "not_ready", "database": "ok", "redis": "error"}`. The response
  intentionally does not expose URLs, credentials, hostnames, stack traces, or
  raw exception messages.

Rate limiting:

- Login, registration, refresh, and WebSocket connection attempts are protected
  by Redis-backed fixed-window limits.
- Limiter keys use the operation name and a hash of the client address. They do
  not include raw IPs, credentials, passwords, access tokens, refresh tokens, or
  emails.
- REST requests over the configured limit receive `429` and a `Retry-After`
  header. WebSocket connection attempts over the configured limit are closed
  with private close code `4408`.
- If limiter Redis is unavailable, the default behavior is fail-open for
  authentication availability; readiness reports Redis failure separately.

Reliability:

- Redis pub/sub fanout reconnects with bounded exponential backoff if the
  listener stops unexpectedly.
- Malformed Redis pub/sub frames are skipped and logged instead of crashing the
  listener loop.
- WebSocket browser clients authenticate through one-time Redis-backed tickets.
  Access-token query authentication remains only as a compatibility fallback.
- Celery workers mark old `running` job-run audit rows as failed at worker child
  startup based on `STALE_JOB_TIMEOUT_MINUTES`; they do not mark stale jobs as
  succeeded.
- Selected uniqueness-race paths roll back the SQLAlchemy session and return
  conflict-oriented domain errors rather than leaking raw database exceptions.
