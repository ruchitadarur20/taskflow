# Implementation Roadmap

## Milestone 0: Foundation

Status: complete.

Deliverables:

- Define project goals and scope.
- Select production-grade technology stack.
- Design high-level architecture.
- Propose repository structure.
- Design database entities and relationships.
- Design authentication and RBAC.
- Define API, frontend, WebSocket, and worker modules.
- Define testing, Docker, CI/CD, security, and observability strategies.
- Create initial documentation files.

No application code is implemented in this milestone.

## Milestone 1: Repository Scaffold and Tooling

Deliverables:

- Create backend and frontend project skeletons.
- Add Python and Node dependency management.
- Configure formatters, linters, type checkers, and pre-commit hooks.
- Add Dockerfiles and Docker Compose for local development.
- Add initial GitHub Actions workflow that validates empty scaffold health.
- Add configuration loading and health check shell only where needed for infrastructure verification.

Exit criteria:

- Backend and frontend tooling install cleanly.
- CI passes on scaffold.
- Local PostgreSQL and Redis start through Docker Compose.

## Milestone 2: Backend Core Infrastructure

Deliverables:

- FastAPI app bootstrap.
- Settings management.
- SQLAlchemy engine/session setup.
- Alembic initialized.
- Structured logging and request IDs.
- Health/readiness endpoints.
- pytest infrastructure.

Exit criteria:

- API boots locally.
- Tests run against isolated database.
- Alembic can create and apply migrations.

## Milestone 3: Authentication and Sessions

Deliverables:

- User model and migration.
- Password hashing.
- Login/logout.
- JWT access tokens.
- Refresh-token rotation and reuse detection.
- Session listing and revocation.
- Auth test coverage.

Exit criteria:

- Token family compromise revokes all related refresh tokens.
- Protected endpoints reject invalid and expired tokens.

## Milestone 4: Workspaces and RBAC

Deliverables:

- Workspace, membership, invite, and audit models.
- Workspace CRUD.
- Membership and invitation flows.
- Workspace role policy engine.
- RBAC tests for allowed and denied cases.

Exit criteria:

- Users can belong to multiple workspaces.
- Workspace permissions are enforced in services.

## Milestone 5: Projects and Tasks

Deliverables:

- Project, project membership, task list, task, label, watcher, comment, and attachment metadata models.
- Project and task CRUD.
- Task movement and assignment.
- Comments and labels.
- Audit events for key mutations.

Exit criteria:

- Core task workflow is usable through API.
- Database constraints protect workspace/project boundaries.

## Milestone 6: Realtime Notifications

Deliverables:

- WebSocket authentication and subscriptions.
- Redis fanout between API instances.
- Notification model and API.
- Task/comment/project event publishing.
- Frontend realtime client.

Exit criteria:

- Multiple clients receive authorized real-time updates.
- Unauthorized subscriptions are rejected.

## Milestone 7: Background Jobs

Deliverables:

- Celery worker and beat setup.
- Email queue.
- Notification fanout jobs.
- Reminder jobs.
- Token and invite cleanup jobs.
- Export job foundation.

Exit criteria:

- Jobs are idempotent and observable.
- Retries and failures are test-covered.

## Milestone 8: Frontend Product Shell

Deliverables:

- React app shell, routing, auth guards.
- API client and refresh handling.
- Workspace and project navigation.
- Task board/list UI foundation.
- Notification UI.

Exit criteria:

- Authenticated users can navigate the core product shell.
- API and WebSocket state reconcile cleanly.

## Milestone 9: Hardening and Deployment Readiness

Deliverables:

- End-to-end smoke tests.
- Production Docker image hardening.
- CI/CD deployment gates.
- Security headers, CORS, rate limiting.
- Observability instrumentation.
- Backup, migration, and rollback runbooks.

Exit criteria:

- App is ready for a staging deployment.
- Operational docs exist for deployment and incidents.
