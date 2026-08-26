# Architecture

## System Overview

TaskFlow will use a modular monolith backend with clear domain boundaries. This keeps the first production version understandable while leaving room to extract services later if traffic, team ownership, or operational needs justify it.

Primary runtime components:

- React frontend served as a static web app.
- FastAPI backend exposing REST APIs and WebSocket endpoints.
- PostgreSQL database for source-of-truth relational data.
- Redis for Celery broker/result backend, cache, rate limiting, and WebSocket fanout.
- Celery workers for asynchronous and scheduled jobs.
- Reverse proxy or cloud ingress terminating TLS and forwarding traffic to the backend and frontend.

## High-Level Request Flow

1. The browser authenticates through the FastAPI auth module.
2. The API issues short-lived JWT access tokens and rotating refresh tokens.
3. REST requests use the access token.
4. WebSocket connections authenticate during connection setup and subscribe to workspace/project/user channels.
5. Write operations commit to PostgreSQL, append audit records, and enqueue jobs or publish events as needed.
6. Celery workers process asynchronous work such as email, reminders, exports, and cleanup.
7. Redis pub/sub fans out real-time events across backend instances.

## Backend Architecture

The backend should be organized by domain module, with shared infrastructure separated from business logic.

Key backend layers:

- API layer: FastAPI routers, request/response schemas, dependency injection.
- Service layer: application use cases and transaction boundaries.
- Domain layer: entities, permissions, policy checks, domain events.
- Persistence layer: SQLAlchemy models, repositories, query objects.
- Worker layer: Celery tasks and scheduled jobs.
- Infrastructure layer: settings, logging, metrics, database sessions, Redis, email, storage, security utilities.

## Frontend Architecture

The frontend should be feature-oriented rather than page-only. Each feature owns its UI components, API hooks, local state, and tests where practical.

Key frontend layers:

- App shell: routing, layout, auth guard, providers.
- API client: typed HTTP client, auth refresh handling, error normalization.
- Features: auth, workspace, project, task, notification, settings.
- Realtime client: WebSocket lifecycle, subscriptions, reconnects, event dispatch.
- Shared UI: design primitives, forms, modals, tables, toasts, empty states.

## Deployment Shape

Initial deployable units:

- `frontend`: static asset build.
- `api`: FastAPI application server.
- `worker`: Celery worker.
- `scheduler`: Celery beat scheduler.
- `postgres`: managed PostgreSQL in production, local container in development.
- `redis`: managed Redis in production, local container in development.

## Proposed Repository Structure

```text
taskflow/
  README.md
  .editorconfig
  .gitignore
  docs/
    architecture.md
    domain-and-api.md
    frontend-realtime-jobs.md
    quality-and-operations.md
    roadmap.md
  backend/
    app/
      api/
      core/
      db/
      domains/
      workers/
      observability/
    alembic/
    tests/
    pyproject.toml
    Dockerfile
  frontend/
    src/
      app/
      api/
      features/
      realtime/
      shared/
      test/
    package.json
    vite.config.ts
    Dockerfile
  infra/
    docker/
    compose/
    nginx/
  .github/
    workflows/
```

Only the documentation files exist in this milestone. The application folders above are the proposed structure for upcoming milestones.
