# Projects and Tasks

Milestone 5 adds the core work-management domain inside existing authenticated workspaces. It
intentionally does not add notifications, WebSockets, Celery business jobs, attachments, task-list
columns, or project-level RBAC.

## Architecture

Project and task behavior lives in `app.domains.projects`:

- `models.py` defines persistence models and enums.
- `schemas.py` defines request and response contracts.
- `service.py` owns authorization checks, validation, mutations, and activity recording.
- `app.api.projects` exposes HTTP routes under `/workspaces/{workspace_id}`.

Routes stay thin. They authenticate the current user, call the project service, and translate
domain errors into stable HTTP responses. Workspace membership and role checks remain in the
workspace policy layer so project authorization is consistent with Milestone 4.

## Data Model

The migration `202608260003_create_project_task_tables.py` creates only project/task-related
tables:

- `projects`: workspace-owned project records with slug uniqueness per workspace.
- `tasks`: project-owned work items with status, priority, assignee, due date, and optional parent.
- `task_dependencies`: directed task dependency edges.
- `labels`: project-scoped labels with validated hex colors.
- `task_labels`: many-to-many task/label links.
- `task_comments`: flat task comments with soft-delete support.
- `activity_events`: workspace-scoped project/task activity history.

Assignments reference existing users, but service validation requires the assignee to be an active
member of the workspace. Parent tasks, dependencies, and labels must belong to the same workspace
and project as the task being changed.

## Authorization

Project/task access uses workspace roles:

- `owner` and `admin`: create, update, archive, label, comment, and moderate comments.
- `member`: create and update projects/tasks, labels, and their own comments.
- `viewer`: read projects, tasks, labels, comments, and activity only.

The service layer denies access when workspace membership is missing, the workspace is archived, or
the role lacks the needed permission. Project-level roles are deliberately excluded from this
milestone.

## Task Lifecycle

Tasks use these statuses:

- `todo`
- `in_progress`
- `blocked`
- `done`
- `archived`

`DELETE /tasks/{task_id}` archives a task by setting `status=archived` and `archived_at`; list
endpoints hide archived tasks. Projects are archived the same way. Status changes, assignment
changes, due-date changes, label changes, comments, and archive actions create activity events.

## Dependencies and Subtasks

Subtasks are represented by `tasks.parent_task_id`. The service rejects:

- self-parenting
- cross-project parents
- archived parents
- parent updates that create a cycle

Dependencies are represented by `task_dependencies`, where `blocking_task_id` must be completed or
resolved before the `blocked_task_id`. The service rejects:

- self-dependencies
- duplicate dependency edges
- cross-project dependencies
- dependency edges that create a cycle

Cycle prevention is enforced in the service before writes. Database constraints cover direct
self-reference, while graph traversal catches longer cycles.

## Endpoint Behavior

Project endpoints:

- `POST /workspaces/{workspace_id}/projects`
- `GET /workspaces/{workspace_id}/projects`
- `GET /workspaces/{workspace_id}/projects/{project_id}`
- `PATCH /workspaces/{workspace_id}/projects/{project_id}`
- `DELETE /workspaces/{workspace_id}/projects/{project_id}`

Task endpoints:

- `POST /workspaces/{workspace_id}/projects/{project_id}/tasks`
- `GET /workspaces/{workspace_id}/projects/{project_id}/tasks`
- `GET /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}`
- `PATCH /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}`
- `DELETE /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}`

Collaboration endpoints:

- `POST /workspaces/{workspace_id}/projects/{project_id}/labels`
- `GET /workspaces/{workspace_id}/projects/{project_id}/labels`
- `POST /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/labels`
- `GET /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/labels`
- `DELETE /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/labels/{label_id}`
- `POST /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/dependencies`
- `GET /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/dependencies`
- `POST /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/comments`
- `GET /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/comments`
- `PATCH /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/comments/{comment_id}`
- `DELETE /workspaces/{workspace_id}/projects/{project_id}/tasks/{task_id}/comments/{comment_id}`
- `GET /workspaces/{workspace_id}/projects/{project_id}/activity`

Errors are intentionally safe and consistent: missing or inaccessible resources return not-found or
forbidden responses without exposing unrelated workspace data.

## Frontend

The authenticated frontend shell now includes a minimal project/task area:

- workspace selection
- project list and project creation
- task creation with assignee, due date, priority, notes
- task status updates
- task detail inspector
- label creation and task-label attachment
- comment creation and display

The UI remains intentionally small. Dashboards, workspaces beyond the existing shell, project boards
with drag and drop, notifications, and real-time collaboration are later milestones.

## Local Testing

From `backend`:

```bash
/private/tmp/taskflow-backend-venv/bin/alembic upgrade head
/private/tmp/taskflow-backend-venv/bin/pytest
/private/tmp/taskflow-backend-venv/bin/ruff check .
/private/tmp/taskflow-backend-venv/bin/mypy app tests
```

From `frontend`:

```bash
npm run build
```

For Docker validation, provide an environment-based JWT secret and run the Compose stack:

```bash
JWT_SECRET_KEY=local-validation-secret-with-at-least-thirty-two-characters docker compose up -d --wait
```
