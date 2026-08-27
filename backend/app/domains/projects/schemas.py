from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domains.projects.models import ProjectStatus, TaskPriority, TaskStatus


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=5000)


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=5000)


class ProjectRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    created_by_id: uuid.UUID
    name: str
    description: str | None
    slug: str
    status: ProjectStatus
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class LabelCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = "#2f7d6d"

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError("Color must be a #RRGGBB hex value")
        int(value[1:], 16)
        return value


class LabelRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    name: str
    color: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=10000)
    status: TaskStatus = TaskStatus.todo
    priority: TaskPriority = TaskPriority.medium
    assignee_id: uuid.UUID | None = None
    due_at: datetime | None = None
    parent_task_id: uuid.UUID | None = None


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=10000)
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    assignee_id: uuid.UUID | None = None
    due_at: datetime | None = None
    parent_task_id: uuid.UUID | None = None


class TaskRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    parent_task_id: uuid.UUID | None
    created_by_id: uuid.UUID
    assignee_id: uuid.UUID | None
    title: str
    description: str | None
    status: TaskStatus
    priority: TaskPriority
    due_at: datetime | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class DependencyCreateRequest(BaseModel):
    blocking_task_id: uuid.UUID


class TaskDependencyRead(BaseModel):
    blocking_task_id: uuid.UUID
    blocked_task_id: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskLabelRequest(BaseModel):
    label_id: uuid.UUID


class CommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class CommentUpdateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class CommentRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ActivityEventRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None
    task_id: uuid.UUID | None
    actor_id: uuid.UUID | None
    event_type: str
    metadata_json: dict[str, object]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
