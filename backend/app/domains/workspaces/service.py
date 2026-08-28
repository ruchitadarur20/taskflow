from __future__ import annotations

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.domains.auth.models import User
from app.domains.auth.security import utc_now
from app.domains.auth.service import get_user_by_email
from app.domains.workspaces.models import (
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
    WorkspaceStatus,
)
from app.domains.workspaces.policies import WorkspaceAction, can


class WorkspaceError(Exception):
    pass


class WorkspaceNotFoundError(WorkspaceError):
    pass


class WorkspaceForbiddenError(WorkspaceError):
    pass


class WorkspaceArchivedError(WorkspaceError):
    pass


class UserNotFoundError(WorkspaceError):
    pass


class DuplicateMembershipError(WorkspaceError):
    pass


class DuplicateWorkspaceError(WorkspaceError):
    pass


class FinalOwnerError(WorkspaceError):
    pass


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "workspace"


def unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    slug = base
    suffix = 2
    while db.scalar(select(Workspace.id).where(Workspace.slug == slug)) is not None:
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def get_membership(
    db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> WorkspaceMember | None:
    return db.scalar(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
    )


def require_membership(db: Session, workspace_id: uuid.UUID, user: User) -> WorkspaceMember:
    membership = get_membership(db, workspace_id, user.id)
    if membership is None:
        raise WorkspaceNotFoundError
    if membership.workspace.status == WorkspaceStatus.archived:
        return membership
    return membership


def require_permission(
    db: Session, workspace_id: uuid.UUID, user: User, action: WorkspaceAction
) -> WorkspaceMember:
    membership = require_membership(db, workspace_id, user)
    if membership.workspace.status == WorkspaceStatus.archived and action != WorkspaceAction.view:
        raise WorkspaceArchivedError
    if not can(membership.role, action):
        raise WorkspaceForbiddenError
    return membership


def owner_count(db: Session, workspace_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role == WorkspaceRole.owner,
            )
        )
        or 0
    )


def require_owner_survives(db: Session, member: WorkspaceMember) -> None:
    if member.role == WorkspaceRole.owner and owner_count(db, member.workspace_id) <= 1:
        raise FinalOwnerError


def create_workspace(db: Session, user: User, name: str) -> Workspace:
    now = utc_now()
    workspace = Workspace(
        owner_id=user.id,
        name=name.strip(),
        slug=unique_slug(db, name),
        status=WorkspaceStatus.active,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    db.flush()
    db.add(
        WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.id,
            role=WorkspaceRole.owner,
            created_at=now,
            updated_at=now,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise DuplicateWorkspaceError from None
    db.refresh(workspace)
    return workspace


def list_workspaces(db: Session, user: User) -> list[tuple[Workspace, WorkspaceRole]]:
    rows = db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == user.id,
            Workspace.status == WorkspaceStatus.active,
        )
        .order_by(Workspace.created_at)
    ).all()
    return [(workspace, role) for workspace, role in rows]


def get_workspace_for_user(
    db: Session, workspace_id: uuid.UUID, user: User
) -> tuple[Workspace, WorkspaceRole]:
    membership = require_permission(db, workspace_id, user, WorkspaceAction.view)
    return membership.workspace, membership.role


def update_workspace(db: Session, workspace_id: uuid.UUID, user: User, name: str) -> Workspace:
    membership = require_permission(db, workspace_id, user, WorkspaceAction.update)
    workspace = membership.workspace
    workspace.name = name.strip()
    workspace.updated_at = utc_now()
    db.commit()
    db.refresh(workspace)
    return workspace


def archive_workspace(db: Session, workspace_id: uuid.UUID, user: User) -> None:
    membership = require_permission(db, workspace_id, user, WorkspaceAction.archive)
    workspace = membership.workspace
    if workspace.status != WorkspaceStatus.archived:
        now = utc_now()
        workspace.status = WorkspaceStatus.archived
        workspace.archived_at = now
        workspace.updated_at = now
        db.commit()


def list_members(db: Session, workspace_id: uuid.UUID, user: User) -> list[WorkspaceMember]:
    require_permission(db, workspace_id, user, WorkspaceAction.view)
    return list(
        db.scalars(
            select(WorkspaceMember)
            .options(selectinload(WorkspaceMember.user))
            .where(WorkspaceMember.workspace_id == workspace_id)
            .order_by(WorkspaceMember.created_at)
        )
    )


def assert_member_management_allowed(
    actor_role: WorkspaceRole,
    *,
    target_role: WorkspaceRole | None = None,
    requested_role: WorkspaceRole | None = None,
) -> None:
    if requested_role == WorkspaceRole.owner and not can(actor_role, WorkspaceAction.assign_owner):
        raise WorkspaceForbiddenError
    if target_role == WorkspaceRole.owner and not can(actor_role, WorkspaceAction.manage_owner):
        raise WorkspaceForbiddenError


def add_member(
    db: Session,
    workspace_id: uuid.UUID,
    actor: User,
    email: str,
    role: WorkspaceRole,
) -> WorkspaceMember:
    actor_membership = require_permission(db, workspace_id, actor, WorkspaceAction.manage_members)
    assert_member_management_allowed(actor_membership.role, requested_role=role)
    target_user = get_user_by_email(db, email)
    if target_user is None:
        raise UserNotFoundError
    if get_membership(db, workspace_id, target_user.id) is not None:
        raise DuplicateMembershipError
    now = utc_now()
    member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=target_user.id,
        role=role,
        created_at=now,
        updated_at=now,
    )
    db.add(member)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise DuplicateMembershipError from None
    db.refresh(member)
    return member


def change_member_role(
    db: Session,
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
    actor: User,
    role: WorkspaceRole,
) -> WorkspaceMember:
    actor_membership = require_permission(db, workspace_id, actor, WorkspaceAction.manage_members)
    target_membership = get_membership(db, workspace_id, target_user_id)
    if target_membership is None:
        raise WorkspaceNotFoundError
    assert_member_management_allowed(
        actor_membership.role, target_role=target_membership.role, requested_role=role
    )
    if target_membership.role == WorkspaceRole.owner and role != WorkspaceRole.owner:
        require_owner_survives(db, target_membership)
    target_membership.role = role
    target_membership.updated_at = utc_now()
    if (
        target_membership.user_id == target_membership.workspace.owner_id
        and role != WorkspaceRole.owner
    ):
        next_owner = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role == WorkspaceRole.owner,
                WorkspaceMember.user_id != target_user_id,
            )
            .order_by(WorkspaceMember.created_at)
        )
        if next_owner is None:
            raise FinalOwnerError
        target_membership.workspace.owner_id = next_owner.user_id
    db.commit()
    db.refresh(target_membership)
    return target_membership


def remove_member(
    db: Session, workspace_id: uuid.UUID, target_user_id: uuid.UUID, actor: User
) -> None:
    actor_membership = require_permission(db, workspace_id, actor, WorkspaceAction.manage_members)
    target_membership = get_membership(db, workspace_id, target_user_id)
    if target_membership is None:
        raise WorkspaceNotFoundError
    assert_member_management_allowed(actor_membership.role, target_role=target_membership.role)
    require_owner_survives(db, target_membership)
    db.delete(target_membership)
    db.commit()
