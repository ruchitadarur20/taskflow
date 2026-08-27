from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.domains.auth.schemas import UserRead
from app.domains.workspaces.models import WorkspaceRole, WorkspaceStatus


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class WorkspaceUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class WorkspaceRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    slug: str
    status: WorkspaceStatus
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    current_user_role: WorkspaceRole

    model_config = ConfigDict(from_attributes=True)


class WorkspaceMemberCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: WorkspaceRole


class WorkspaceMemberUpdateRequest(BaseModel):
    role: WorkspaceRole


class WorkspaceMemberRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    role: WorkspaceRole
    created_at: datetime
    updated_at: datetime
    user: UserRead

    model_config = ConfigDict(from_attributes=True)
