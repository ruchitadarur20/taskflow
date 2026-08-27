# TaskFlow

TaskFlow is a production-grade collaborative task management platform for teams that need workspaces, projects, tasks, real-time updates, background processing, and secure role-based access control.

This repository has implemented the foundation, authentication/session management, workspace/RBAC,
core project/task, realtime/notifications, and background job milestones. Later milestones will
add the frontend product shell, richer task workflows, and production hardening.

## Product Goals

- Support multi-workspace collaboration with projects, tasks, comments, assignments, notifications, and auditability.
- Provide secure JWT authentication with refresh-token rotation and role-based access control.
- Deliver real-time task and notification updates over WebSockets.
- Use background jobs for email delivery, notification fanout, cleanup, exports, reminders, and audit processing.
- Be deployable through Docker-based environments with CI/CD, observability, and security checks.
- Keep the architecture modular enough for future billing, integrations, search, and analytics.

## Initial Scope

In scope:

- User accounts and authentication.
- Workspaces, workspace memberships, projects, task lists, tasks, comments, labels, attachments metadata, notifications, and audit logs.
- RBAC across workspace and project resources.
- REST API with FastAPI.
- WebSocket channels for presence, task updates, and notifications.
- Celery workers backed by Redis.
- PostgreSQL persistence through SQLAlchemy and Alembic.
- React + TypeScript frontend.
- pytest-based backend testing.
- Docker Compose for local orchestration.
- GitHub Actions for linting, tests, security checks, builds, and deployment gates.

Out of scope for the first implementation phase:

- Billing and subscriptions.
- Public marketplace integrations.
- Native mobile apps.
- Offline-first synchronization.
- Full-text search beyond PostgreSQL capabilities.
- Advanced analytics and data warehouse pipelines.

## Target Stack

- Frontend: React, TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS or CSS Modules.
- Backend: Python, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic, Uvicorn/Gunicorn.
- Database: PostgreSQL.
- Background jobs: Celery, Redis.
- Realtime: FastAPI WebSockets with Redis pub/sub for multi-instance fanout.
- Testing: pytest, pytest-asyncio, HTTPX, factory_boy, Testcontainers or Docker Compose services.
- Infrastructure: Docker, Docker Compose.
- CI/CD: GitHub Actions.
- Observability: structured logs, OpenTelemetry-ready tracing, metrics endpoint, health checks.

## Documentation Index

- [Architecture](docs/architecture.md)
- [Authentication](docs/authentication.md)
- [Workspaces and RBAC](docs/workspaces-and-rbac.md)
- [Projects and Tasks](docs/projects-and-tasks.md)
- [Realtime and Notifications](docs/realtime-and-notifications.md)
- [Background Jobs](docs/background-jobs.md)
- [Database Design](docs/database.md)
- [Data Model, Auth, RBAC, and API Modules](docs/domain-and-api.md)
- [Frontend, WebSockets, and Background Jobs](docs/frontend-realtime-jobs.md)
- [Testing, Docker, CI/CD, Security, and Observability](docs/quality-and-operations.md)
- [Implementation Roadmap](docs/roadmap.md)

## Milestone Status

Complete through Milestone 7: background jobs.
