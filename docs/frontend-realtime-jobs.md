# Frontend, WebSockets, and Background Jobs

## Frontend Modules

`app`

- Router, providers, global layout, auth boundaries, route-level error handling.

`api`

- Typed API client, request interceptors, refresh flow, response normalization, generated or manually maintained types.

`features/auth`

- Login, logout, token refresh coordination, session expiry, password reset, email verification.

`features/workspaces`

- Workspace switcher, settings, membership, invites, roles.

`features/projects`

- Project list, project detail shell, settings, archive states.

`features/tasks`

- Task board/list views, task detail panel, task forms, assignment, labels, comments, watchers.

`features/notifications`

- Notification bell, inbox, read state, realtime updates.

`features/audit`

- Workspace audit log views for authorized users.

`realtime`

- WebSocket client, reconnect strategy, channel subscription, event dispatch, optimistic update reconciliation.

`shared`

- Design primitives, forms, validation helpers, date/time utilities, accessibility helpers, test utilities.

## WebSocket Usage

WebSockets should support collaboration signals without replacing REST as the source of truth.

Connection:

- Client connects with a valid access token or an authenticated cookie-derived session.
- Server validates user identity and active membership for requested channels.
- Client sends subscription messages after connection.
- Server sends heartbeat/ping messages and disconnects stale clients.

Channels:

- `user:{user_id}` for personal notifications and session events.
- `workspace:{workspace_id}` for workspace-level events visible to members.
- `project:{project_id}` for task and project changes.
- `task:{task_id}` for focused task detail collaboration.

Event types:

- `notification.created`
- `notification.read`
- `task.created`
- `task.updated`
- `task.moved`
- `task.deleted`
- `comment.created`
- `comment.updated`
- `workspace.member_changed`
- `project.member_changed`
- `presence.updated`

Scaling:

- Use Redis pub/sub or Redis Streams for fanout between API instances.
- Keep WebSocket messages small and event-oriented.
- Clients refetch affected queries through TanStack Query after receiving mutation events.
- Use event IDs for deduplication.

## Celery + Redis Background Jobs

Queues:

- `default`: ordinary asynchronous work.
- `email`: transactional email.
- `notifications`: notification fanout and digest preparation.
- `maintenance`: cleanup, revocation sweeps, retention tasks.
- `exports`: workspace/project exports and larger generated files.

Jobs:

- Send email verification, password reset, invitation, assignment, mention, and reminder emails.
- Fan out notifications after task/comment/membership events.
- Build daily or weekly notification digests.
- Run due-date reminder scans.
- Revoke expired refresh tokens and invite tokens.
- Clean up orphaned attachment metadata and expired upload reservations.
- Generate project or workspace exports.
- Persist selected audit-derived metrics.

Scheduling:

- Use Celery beat for periodic jobs.
- Keep scheduled jobs idempotent and safe to retry.
- Use database locks or Redis locks for singleton periodic jobs.

Reliability:

- Tasks should use explicit retry policies, dead-letter handling strategy, and structured logs.
- Long-running jobs should update progress records if user-visible.
- Use idempotency keys for jobs triggered by API mutations.
- Do not put security-critical state changes only in asynchronous workers.
