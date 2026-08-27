from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None
    task_id: uuid.UUID | None
    actor_id: uuid.UUID | None
    type: str
    title: str
    body: str | None
    payload_json: dict[str, object]
    read_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UnreadCountRead(BaseModel):
    unread_count: int
