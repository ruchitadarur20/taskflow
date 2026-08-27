from __future__ import annotations

from enum import StrEnum

from app.domains.workspaces.models import WorkspaceRole


class WorkspaceAction(StrEnum):
    view = "view"
    update = "update"
    archive = "archive"
    manage_members = "manage_members"
    assign_owner = "assign_owner"
    manage_owner = "manage_owner"


PERMISSIONS: dict[WorkspaceRole, set[WorkspaceAction]] = {
    WorkspaceRole.owner: {
        WorkspaceAction.view,
        WorkspaceAction.update,
        WorkspaceAction.archive,
        WorkspaceAction.manage_members,
        WorkspaceAction.assign_owner,
        WorkspaceAction.manage_owner,
    },
    WorkspaceRole.admin: {
        WorkspaceAction.view,
        WorkspaceAction.update,
        WorkspaceAction.manage_members,
    },
    WorkspaceRole.member: {WorkspaceAction.view},
    WorkspaceRole.viewer: {WorkspaceAction.view},
}


def can(role: WorkspaceRole, action: WorkspaceAction) -> bool:
    return action in PERMISSIONS[role]
