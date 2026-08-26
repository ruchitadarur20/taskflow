# Data Model, Auth, RBAC, and API Modules

## Core Entities

`users`

- Represents an account holder.
- Key fields: id, email, password_hash, display_name, avatar_url, status, email_verified_at, created_at, updated_at.
- Relationships: workspace memberships, assigned tasks, comments, notifications, audit events.

`refresh_tokens`

- Stores hashed refresh tokens for rotation and revocation.
- Key fields: id, user_id, token_hash, family_id, parent_token_id, revoked_at, replaced_by_token_id, expires_at, created_at, last_used_at, user_agent, ip_address.
- Relationships: belongs to user.

`workspaces`

- Top-level collaboration boundary.
- Key fields: id, name, slug, owner_id, status, created_at, updated_at.
- Relationships: members, projects, labels, audit events.

`workspace_memberships`

- Connects users to workspaces and grants workspace-level roles.
- Key fields: id, workspace_id, user_id, role, status, invited_by_id, joined_at, created_at.
- Uniqueness: one active membership per user per workspace.

`projects`

- Groups related task work inside a workspace.
- Key fields: id, workspace_id, name, slug, description, status, visibility, created_by_id, archived_at, created_at, updated_at.
- Relationships: task lists, tasks, project memberships, labels.

`project_memberships`

- Optional project-specific access layer for private projects.
- Key fields: id, project_id, user_id, role, created_at.

`task_lists`

- Ordered columns or sections within a project.
- Key fields: id, project_id, name, position, created_at, updated_at.
- Relationships: tasks.

`tasks`

- Work items.
- Key fields: id, project_id, task_list_id, title, description, status, priority, assignee_id, reporter_id, due_at, position, completed_at, created_at, updated_at.
- Relationships: comments, labels, attachments metadata, watchers, audit events.

`task_comments`

- Threaded or flat discussion on tasks.
- Key fields: id, task_id, author_id, body, edited_at, deleted_at, created_at.

`labels`

- Workspace-scoped labels usable on tasks.
- Key fields: id, workspace_id, name, color, created_at.

`task_labels`

- Many-to-many join table between tasks and labels.
- Key fields: task_id, label_id.

`task_watchers`

- Users subscribed to task updates.
- Key fields: task_id, user_id, created_at.

`attachments`

- Metadata for files attached to tasks or comments. Binary storage should live outside PostgreSQL.
- Key fields: id, workspace_id, task_id, comment_id, uploaded_by_id, storage_key, filename, content_type, size_bytes, checksum, created_at.

`notifications`

- User-visible notification records.
- Key fields: id, user_id, workspace_id, actor_id, type, title, body, payload_json, read_at, created_at.

`audit_logs`

- Immutable event trail for security and collaboration.
- Key fields: id, workspace_id, actor_id, entity_type, entity_id, action, before_json, after_json, metadata_json, created_at.

`workspace_invites`

- Invitation lifecycle.
- Key fields: id, workspace_id, email, role, token_hash, invited_by_id, accepted_by_id, expires_at, accepted_at, revoked_at, created_at.

## Relationships

- User has many workspace memberships.
- Workspace has many users through workspace memberships.
- Workspace has many projects, labels, notifications, invites, and audit logs.
- Project belongs to workspace and has many task lists and tasks.
- Task belongs to project and usually belongs to a task list.
- Task optionally belongs to an assignee and reporter.
- Task has many comments, labels, watchers, attachments, and audit logs.
- Notification belongs to a recipient user and may belong to a workspace.
- Refresh tokens belong to users and form token families for rotation detection.

## Authentication Design

- Access tokens: short-lived signed JWTs, recommended lifetime 5-15 minutes.
- Refresh tokens: opaque random tokens stored only as hashes in PostgreSQL.
- Refresh rotation: every refresh request invalidates the previous refresh token and issues a new token in the same family.
- Reuse detection: if an already-revoked refresh token is reused, revoke the whole token family and require reauthentication.
- Passwords: hash with Argon2id or bcrypt using strong parameters.
- Token transport: prefer secure, HTTP-only, SameSite cookies for refresh tokens; use authorization headers or in-memory access token storage for access tokens.
- Session metadata: store user agent, IP hash or IP address according to privacy requirements, last_used_at, and revoked_at.
- Account recovery and email verification should use single-use hashed tokens with expiration.

## RBAC Design

Workspace roles:

- Owner: full workspace control, ownership transfer, billing-ready authority, destructive administration.
- Admin: manage members, projects, settings, labels, and most content.
- Member: create and edit projects and tasks according to project visibility.
- Viewer: read-only access to visible workspace content.

Project roles:

- Project Admin: manage project settings, members, lists, and all tasks.
- Editor: create and update tasks, comments, labels on tasks.
- Commenter: read tasks and add comments.
- Viewer: read-only project access.

Permission strategy:

- Enforce permissions in the service layer, not only in routers.
- Keep policy checks explicit and testable.
- Combine workspace role, project visibility, project membership, and task ownership where needed.
- Deny by default when membership is missing, inactive, or ambiguous.
- Add audit logs for security-sensitive actions and permission changes.

## API Modules

`auth`

- Login, logout, token refresh, session listing, session revocation, password reset, email verification.

`users`

- Current user profile, preferences, avatar metadata, notification settings.

`workspaces`

- Workspace CRUD, workspace settings, membership management, invites, role changes.

`projects`

- Project CRUD, project membership, archive/restore, project settings.

`task_lists`

- List creation, ordering, renaming, deletion constraints.

`tasks`

- Task CRUD, assignment, movement, status changes, priority, due dates, watchers.

`comments`

- Task comments, edits, soft deletion.

`labels`

- Workspace labels and task-label assignment.

`attachments`

- Attachment metadata, upload authorization, download authorization, deletion.

`notifications`

- List notifications, mark read/unread, bulk read, notification preferences.

`audit`

- Workspace-scoped audit log reads for authorized roles.

`health`

- Liveness, readiness, version, dependency health.

`admin`

- Internal operational endpoints gated behind strict role and environment controls.
