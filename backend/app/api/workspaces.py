from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.domains.auth.models import User
from app.domains.workspaces import service
from app.domains.workspaces.models import Workspace, WorkspaceMember, WorkspaceRole
from app.domains.workspaces.schemas import (
    WorkspaceCreateRequest,
    WorkspaceMemberCreateRequest,
    WorkspaceMemberRead,
    WorkspaceMemberUpdateRequest,
    WorkspaceRead,
    WorkspaceUpdateRequest,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def workspace_response(workspace: Workspace, role: WorkspaceRole) -> WorkspaceRead:
    return WorkspaceRead(
        id=workspace.id,
        owner_id=workspace.owner_id,
        name=workspace.name,
        slug=workspace.slug,
        status=workspace.status,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
        archived_at=workspace.archived_at,
        current_user_role=role,
    )


def member_response(member: WorkspaceMember) -> WorkspaceMemberRead:
    return WorkspaceMemberRead.model_validate(member)


def translate_workspace_error(error: service.WorkspaceError) -> HTTPException:
    if isinstance(error, service.WorkspaceNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if isinstance(error, service.UserNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if isinstance(error, service.DuplicateMembershipError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Membership already exists"
        )
    if isinstance(error, service.FinalOwnerError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Workspace must keep at least one owner",
        )
    if isinstance(error, service.WorkspaceArchivedError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workspace is archived")
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
def create_workspace(
    payload: WorkspaceCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceRead:
    workspace = service.create_workspace(db, current_user, payload.name)
    return workspace_response(workspace, WorkspaceRole.owner)


@router.get("", response_model=list[WorkspaceRead])
def list_workspaces(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[WorkspaceRead]:
    return [
        workspace_response(workspace, role)
        for workspace, role in service.list_workspaces(db, current_user)
    ]


@router.get("/{workspace_id}", response_model=WorkspaceRead)
def get_workspace(
    workspace_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceRead:
    try:
        workspace, role = service.get_workspace_for_user(db, workspace_id, current_user)
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None
    return workspace_response(workspace, role)


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
def update_workspace(
    workspace_id: uuid.UUID,
    payload: WorkspaceUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceRead:
    try:
        workspace = service.update_workspace(db, workspace_id, current_user, payload.name)
        _, role = service.get_workspace_for_user(db, workspace_id, current_user)
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None
    return workspace_response(workspace, role)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_workspace(
    workspace_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    try:
        service.archive_workspace(db, workspace_id, current_user)
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberRead])
def list_members(
    workspace_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[WorkspaceMemberRead]:
    try:
        members = service.list_members(db, workspace_id, current_user)
        return [member_response(member) for member in members]
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None


@router.post(
    "/{workspace_id}/members",
    response_model=WorkspaceMemberRead,
    status_code=status.HTTP_201_CREATED,
)
def add_member(
    workspace_id: uuid.UUID,
    payload: WorkspaceMemberCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceMemberRead:
    try:
        return member_response(
            service.add_member(db, workspace_id, current_user, payload.email, payload.role)
        )
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None


@router.patch("/{workspace_id}/members/{user_id}", response_model=WorkspaceMemberRead)
def change_member_role(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: WorkspaceMemberUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceMemberRead:
    try:
        return member_response(
            service.change_member_role(db, workspace_id, user_id, current_user, payload.role)
        )
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None


@router.delete("/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    try:
        service.remove_member(db, workspace_id, user_id, current_user)
    except service.WorkspaceError as error:
        raise translate_workspace_error(error) from None
