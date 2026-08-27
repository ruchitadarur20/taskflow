# Workspaces and RBAC

Milestone 5 adds the workspace boundary and workspace-level authorization layer.
It does not implement projects, tasks, comments, notifications, or project-level permissions.

## Domain Model

`workspaces` stores the collaboration container:

- `id`
- `owner_id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`
- `archived_at`

`workspace_members` connects users to workspaces:

- `id`
- `workspace_id`
- `user_id`
- `role`
- `created_at`
- `updated_at`

Each `(workspace_id, user_id)` pair is unique, so a user cannot have duplicate membership in the same workspace.

## Membership Lifecycle

1. A workspace is created by an authenticated user.
2. The creator becomes the workspace owner and receives an owner membership in the same transaction.
3. Owners and admins can add existing users as members, subject to owner-sensitive restrictions.
4. Members can be removed unless that removal would leave the workspace without an owner.
5. Role changes are persisted on the membership row and update the membership timestamp.
6. Archived workspaces remain in the database but reject mutating operations.

## Permission Matrix

| Action | Owner | Admin | Member | Viewer |
| --- | --- | --- | --- | --- |
| View workspace | Yes | Yes | Yes | Yes |
| List members | Yes | Yes | Yes | Yes |
| Update workspace | Yes | Yes | No | No |
| Archive workspace | Yes | No | No | No |
| Add non-owner members | Yes | Yes | No | No |
| Change non-owner roles | Yes | Yes | No | No |
| Remove non-owner members | Yes | Yes | No | No |
| Assign owner role | Yes | No | No | No |
| Demote/remove owner | Yes, if another owner remains | No | No | No |

## Authorization Architecture

Authentication answers who the caller is through `get_current_user`.
Authorization answers what that user can do through the workspace policy layer.

- `app/domains/workspaces/policies.py` defines workspace actions and role capabilities.
- `app/domains/workspaces/service.py` applies policy checks before mutations.
- `app/api/workspaces.py` translates domain errors into HTTP responses.

Route handlers do not embed role matrices. This keeps future project, task, comment, and notification permissions able to reuse the same pattern.

## Ownership Rules

- Every workspace has an `owner_id` foreign key to `users`.
- Workspace creation always creates an owner membership.
- The final owner cannot be removed or demoted.
- Admins cannot assign the owner role.
- Admins cannot demote or remove owners.
- Owners may assign another owner, then demote or remove themselves.

## API Behavior

- `POST /workspaces`: creates a workspace and owner membership.
- `GET /workspaces`: lists active workspaces where the caller is a member.
- `GET /workspaces/{workspace_id}`: returns detail for members only.
- `PATCH /workspaces/{workspace_id}`: owner/admin update.
- `DELETE /workspaces/{workspace_id}`: owner-only archive.
- `GET /workspaces/{workspace_id}/members`: member-visible member list.
- `POST /workspaces/{workspace_id}/members`: owner/admin add member.
- `PATCH /workspaces/{workspace_id}/members/{user_id}`: owner/admin role change with owner-sensitive protections.
- `DELETE /workspaces/{workspace_id}/members/{user_id}`: owner/admin member removal with owner-sensitive protections.

Non-members receive `404` for workspace-scoped resources to avoid exposing workspace existence.

## Security Decisions

- Backend authorization is mandatory; frontend role display is not trusted.
- Role values are validated by Pydantic enum schemas.
- Duplicate membership is blocked by both service logic and a database unique constraint.
- Archive is a soft-delete strategy for the workspace boundary in this milestone.
- Archived workspaces remain readable to members but reject mutations.
- Cross-workspace operations require membership in the target workspace.
