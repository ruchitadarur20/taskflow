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
    write_project_content = "write_project_content"
    moderate_project_content = "moderate_project_content"


PERMISSIONS: dict[WorkspaceRole, set[WorkspaceAction]] = {
    WorkspaceRole.owner: {
        WorkspaceAction.view,
        WorkspaceAction.update,
        WorkspaceAction.archive,
        WorkspaceAction.manage_members,
        WorkspaceAction.assign_owner,
        WorkspaceAction.manage_owner,
        WorkspaceAction.write_project_content,
        WorkspaceAction.moderate_project_content,
    },
    WorkspaceRole.admin: {
        WorkspaceAction.view,
        WorkspaceAction.update,
        WorkspaceAction.manage_members,
        WorkspaceAction.write_project_content,
        WorkspaceAction.moderate_project_content,
    },
    WorkspaceRole.member: {WorkspaceAction.view, WorkspaceAction.write_project_content},
    WorkspaceRole.viewer: {WorkspaceAction.view},
}


def can(role: WorkspaceRole, action: WorkspaceAction) -> bool:
    return action in PERMISSIONS[role]
