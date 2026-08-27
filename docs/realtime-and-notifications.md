# Realtime and Notifications

Milestone 6 adds authenticated WebSocket connections, a Redis-backed fanout layer,
persistent notifications, and a minimal frontend realtime client on top of the
existing Projects and Tasks domain. It intentionally does not add Celery jobs,
email delivery, scheduled reminders, digests, or a redesigned product UI.

## Architecture

Realtime infrastructure lives in `app.realtime`, separate from domain code:

- `channels.py` - builds the three channel name shapes (`taskflow:user:{id}`,
  `taskflow:workspace:{id}`, `taskflow:project:{id}`).
- `events.py` - the versioned `RealtimeEnvelope` schema, the mapping from
  activity-log event types to realtime event types, and a SQLAlchemy
  `after_commit`/`after_rollback` session hook that flushes queued events only
  once a transaction actually commits.
- `broker.py` - the `RealtimeBroker` adapter boundary (`RedisBroker` for
  production, `InMemoryBroker` for tests/dev), isolated behind a `publish`
  method domain code calls without knowing which implementation is active.
- `connection_manager.py` - tracks which locally-connected WebSockets are
  subscribed to which channels and fans a message out to them.
- `app.api.realtime` - the `/ws` WebSocket endpoint: authentication and
  subscribe/unsubscribe protocol.
- `app.domains.notifications` - persistent notification storage, following the
  same `models.py` / `schemas.py` / `service.py` layering as every other
  domain.

Domain code (`app.domains.projects.service.record_activity`) does not import
Redis or know about WebSockets. It calls `queue_workspace_event`, which stores
a pending envelope on the SQLAlchemy session; the envelope only reaches the
broker after `db.commit()` succeeds, so a rolled-back mutation never produces a
phantom realtime event.

## Authentication

WebSocket connections authenticate with the same JWT access token used by the
REST API. Browsers cannot set an `Authorization` header on a WebSocket
handshake, so the token is passed as a query parameter: `/ws?token=<access
token>`. The server decodes it with the same `decode_access_token` function
`get_current_user` uses, and rejects a missing or invalid token by closing the
connection (code `4401`) before `accept()` - the socket is never opened for an
unauthenticated caller.

## Subscription Model

After a successful connection, the server automatically subscribes the socket
to the caller's personal channel (`user:{user_id}`) - this is where
`notification.created` and `notification.read` events are delivered, and it
needs no further action from the client.

The client then sends explicit subscribe/unsubscribe messages for broader
scopes:

```json
{"action": "subscribe", "scope": "workspace", "workspace_id": "<uuid>"}
{"action": "subscribe", "scope": "project", "workspace_id": "<uuid>", "project_id": "<uuid>"}
```

Every subscribe request is authorized before the socket is added to a
channel, by calling the same service functions the REST API uses -
`get_workspace_for_user` / `get_project_for_user` from
`app.domains.workspaces.service` and `app.domains.projects.service` - so
workspace/project authorization for realtime traffic can never drift from
authorization for REST traffic. A workspace-id or project-id supplied by the
client is never trusted on its own: it must resolve to a workspace the caller
is a member of, and a project must additionally belong to that same
workspace. A denied subscribe request gets an `{"type": "error", ...}` frame
back; the socket itself stays open so a client can subscribe to other,
authorized channels without reconnecting.

## Event Types and Schema

Every message pushed to a subscriber (other than connection acks) is a
`RealtimeEnvelope`:

```json
{
  "schema_version": 1,
  "event_id": "<uuid>",
  "event_type": "task.status_changed",
  "workspace_id": "<uuid>",
  "project_id": "<uuid|null>",
  "task_id": "<uuid|null>",
  "actor_id": "<uuid|null>",
  "occurred_at": "2026-08-26T00:00:00Z",
  "data": { "...": "small, structured metadata only" }
}
```

`event_type` is a closed `RealtimeEventType` enum, not a free-form string:
`project.created`, `project.updated`, `project.archived`, `task.created`,
`task.updated`, `task.status_changed`, `task.assignee_changed`,
`task.due_date_changed`, `task.archived`, `task.dependency_added`,
`task.label_added`, `task.label_removed`, `comment.created`,
`notification.created`, `notification.read`. `schema_version` lets the
envelope evolve later without breaking older clients, and `event_id` lets a
client deduplicate a delivery it has already processed (see Reconnects below).

Every mutation that already recorded an `ActivityEvent` (project/task service
layer) produces exactly one realtime envelope with the same event type,
mapped 1:1 except `task.comment_added` (the activity-log name) which is
exposed as `comment.created` on the wire.

## Redis Fanout

```
mutation -> record_activity() queues envelope on the session
         -> db.commit() succeeds
         -> after_commit hook calls broker.publish(channel, envelope_json)
         -> RedisBroker: PUBLISH on Redis
         -> every API instance's background listener (psubscribe "taskflow:*")
         -> that instance's local ConnectionManager
         -> authorized, locally-connected WebSocket(s)
```

Every event is published to its workspace channel; if it has a `project_id`
it is additionally published to that project's channel, so a project-scoped
subscriber only sees events for that project while a workspace-scoped
subscriber sees everything in the workspace. Notifications are published only
to the recipient's personal `user:{id}` channel.

Because delivery always goes through Redis - even for a socket connected to
the same instance that published the event - a single delivery path works
identically whether the API is running as one instance or many, with no
separate in-process fast path to keep in sync. `RedisBroker.publish` is a
synchronous, best-effort call (wrapped so a Redis outage logs a warning
instead of failing the caller's HTTP request); the subscriber side runs an
async listener task started in the FastAPI `lifespan`.

Tests and local development can swap in `InMemoryBroker`, which implements the
identical `publish` contract but delivers directly to the local
`ConnectionManager` on the event loop captured at `start()` - no live Redis
required, and the full authorization -> publish -> fanout -> WebSocket path is
still exercised end-to-end.

## Notifications

`notifications` (new table, migration `202608260004`) stores one row per
recipient: `user_id`, `workspace_id`, optional `project_id`/`task_id`,
`actor_id`, a `type` string, `title`, optional `body`, a `payload_json` blob,
`read_at`, `created_at`.

Notifications are created inline with the mutation that causes them (same
transaction as the `ActivityEvent`, via `app.domains.notifications.service.
create_notification`), not by a background job:

- assigning a task notifies the new assignee (`task.assignee_changed`),
  unless the actor assigned it to themselves.
- changing a task's status notifies its assignee (`task.status_changed`),
  unless the actor is the assignee.
- commenting on a task notifies the task's assignee and creator
  (`comment.created`), excluding the comment's own author.

Each `create_notification` call also queues a `notification.created` realtime
event on the recipient's personal channel, so a connected client's unread
badge updates immediately without polling.

Endpoints (`app.api.notifications`, all scoped to the current user):

- `GET /notifications?workspace_id=&unread_only=&limit=&offset=`
- `GET /notifications/unread-count?workspace_id=`
- `POST /notifications/{notification_id}/read`

`mark_read` is idempotent and 404s for a notification that does not belong to
the caller - ownership is enforced at the query level (`user_id ==
current_user.id`), the same pattern used elsewhere in the codebase rather than
a bespoke check.

## Frontend

`src/realtime/client.ts` exports `RealtimeClient`: one WebSocket per session,
constructed with the current access token.

- **Connect**: opens `wss://.../ws?token=<accessToken>`.
- **Reconnect**: on an unexpected close, reconnects with exponential backoff
  (1s, 2s, 4s, ... capped at 15s), reset on a successful `open`.
- **Resubscribe**: every active subscription is tracked client-side and
  resent as soon as the server's `"connected"` ack arrives - covering both the
  first connection and every reconnect, with no special-casing needed at call
  sites.
- **Dedup**: every envelope's `event_id` is checked against a bounded
  (500-entry) recently-seen set before dispatch, so an event redelivered
  around a reconnect is only handled once.
- **Typed dispatch**: `onEvent(listener)` hands subscribers a typed
  `RealtimeEvent`; `onStatusChange(listener)` reports `"connecting" |
  "connected" | "disconnected"`.

`AuthShell` owns one `RealtimeClient` for the session's lifetime (recreated
only if the access token itself changes, e.g. after a refresh) and passes it
to:

- `NotificationBell` - loads the initial notification list/unread count over
  REST, then increments the badge and refetches the list on
  `notification.created`; marking a notification read calls the REST
  endpoint and decrements the badge locally.
- `ProjectTaskShell` - subscribes to the selected workspace's channel, and to
  the selected project's channel (unsubscribing the previous project on
  change). On a `project.*`/`task.*`/`comment.*` event scoped to what's
  currently open, it refetches the affected list (projects, tasks, labels,
  comments) through the same REST functions used for the initial load,
  rather than hand-merging partial event payloads into local state.

## Failure and Reconnect Strategy

- An invalid/expired/missing token closes the WebSocket at handshake time;
  the frontend's reconnect loop will keep retrying with backoff, which is
  appropriate since a token can become valid again after a session refresh
  updates `AuthShell`'s stored session and recreates the client.
- A denied subscribe request returns an error frame and leaves the socket
  open; it never terminates the connection over one unauthorized channel.
- If Redis is unreachable, `RedisBroker.publish` logs a warning and returns
  rather than raising - a mutation still succeeds and is still visible on
  refresh/reload, it simply isn't pushed live until Redis recovers. The
  background listener task similarly logs and stops cleanly on an
  unrecoverable Redis error rather than crashing the process.
- No custom application-level heartbeat/ping is implemented; the underlying
  WebSocket protocol's built-in ping/pong (handled by the ASGI server) is
  relied on for keepalive. Detecting and evicting silently-stale connections
  is a known limitation - see below.

## Known Limitations

- No stale-connection eviction beyond protocol-level ping/pong; a socket that
  drops without a clean close can linger in `ConnectionManager` until the next
  failed `send` is caught.
- Workspace membership/role changes are not yet published as realtime events
  (only project/task/comment/notification activity is); a member removed from
  a workspace stays subscribed until their token expires or they reconnect.
- Notifications have no read-all/bulk-read endpoint yet, and no
  digest/summary - only per-notification mark-read.
- No delivery guarantee across a connection gap: if a client is disconnected
  when an event is published, it is not replayed on reconnect - the frontend
  covers this by refetching the relevant list, not by requesting a backlog.

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

For Docker validation, provide an environment-based JWT secret, bring the
stack up, and apply migrations against the containerized Postgres:

```bash
export JWT_SECRET_KEY=local-validation-secret-with-at-least-thirty-two-characters
docker compose up -d --build --wait
docker compose exec api alembic upgrade head
docker compose exec postgres pg_isready -U taskflow -d taskflow
docker compose exec redis redis-cli ping
curl -s http://localhost:8000/health/live
docker compose down
```
