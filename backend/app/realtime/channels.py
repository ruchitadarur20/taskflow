from __future__ import annotations

import uuid

CHANNEL_PREFIX = "taskflow"


def user_channel(user_id: uuid.UUID) -> str:
    return f"{CHANNEL_PREFIX}:user:{user_id}"


def workspace_channel(workspace_id: uuid.UUID) -> str:
    return f"{CHANNEL_PREFIX}:workspace:{workspace_id}"


def project_channel(project_id: uuid.UUID) -> str:
    return f"{CHANNEL_PREFIX}:project:{project_id}"
