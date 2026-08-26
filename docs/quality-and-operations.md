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
