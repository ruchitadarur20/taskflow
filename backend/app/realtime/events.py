from __future__ import annotations

import logging
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.realtime.broker import get_broker
from app.realtime.channels import project_channel, user_channel, workspace_channel

logger = logging.getLogger("app.realtime")

SCHEMA_VERSION = 1

_PENDING_EVENTS_KEY = "_pending_realtime_events"


class RealtimeEventType(StrEnum):
    project_created = "project.created"
    project_updated = "project.updated"
    project_archived = "project.archived"
    task_created = "task.created"
    task_updated = "task.updated"
    task_status_changed = "task.status_changed"
    task_assignee_changed = "task.assignee_changed"
    task_due_date_changed = "task.due_date_changed"
    task_archived = "task.archived"
    task_dependency_added = "task.dependency_added"
    task_label_added = "task.label_added"
    task_label_removed = "task.label_removed"
    comment_created = "comment.created"
    notification_created = "notification.created"
    notification_read = "notification.read"


class RealtimeEnvelope(BaseModel):
    """The one shape every realtime message takes on the wire.

    `schema_version` lets the frontend (or a future API version) evolve the
    envelope without guessing; `event_id` lets subscribers deduplicate deliveries
    that arrive more than once (e.g. across a reconnect).
    """

    schema_version: int = SCHEMA_VERSION
    event_id: uuid.UUID
    event_type: RealtimeEventType
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    actor_id: uuid.UUID | None = None
    occurred_at: datetime
    data: dict[str, Any] = {}


# Activity-log event types (app.domains.projects.service.record_activity) that map
# onto a different, externally-facing realtime event name. Anything not listed here
# is passed through unchanged when its string value matches a RealtimeEventType.
_ACTIVITY_TYPE_ALIASES: dict[str, str] = {
    "task.comment_added": RealtimeEventType.comment_created.value,
}


def realtime_event_type_for_activity(activity_event_type: str) -> RealtimeEventType | None:
    candidate = _ACTIVITY_TYPE_ALIASES.get(activity_event_type, activity_event_type)
    try:
        return RealtimeEventType(candidate)
    except ValueError:
        return None


def queue_workspace_event(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    event_type: str,
    project_id: uuid.UUID | None,
    task_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    occurred_at: datetime,
    metadata: dict[str, Any],
) -> None:
    """Queue a workspace/project-scoped event on the current transaction.

    The event is only handed to the broker after the transaction actually commits
    (see `_flush_after_commit` below), so a rollback never leaks a phantom event.
    """
    realtime_type = realtime_event_type_for_activity(event_type)
    if realtime_type is None:
        return
    envelope = RealtimeEnvelope(
        event_id=uuid.uuid4(),
        event_type=realtime_type,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        occurred_at=occurred_at,
        data=_stringify(metadata),
    )
    channels = [workspace_channel(workspace_id)]
    if project_id is not None:
        channels.append(project_channel(project_id))
    _pending(db).append((channels, envelope))


def queue_user_event(
    db: Session,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    event_type: RealtimeEventType,
    project_id: uuid.UUID | None,
    task_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    occurred_at: datetime,
    data: dict[str, Any],
) -> None:
    envelope = RealtimeEnvelope(
        event_id=uuid.uuid4(),
        event_type=event_type,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        occurred_at=occurred_at,
        data=_stringify(data),
    )
    _pending(db).append(([user_channel(user_id)], envelope))


def _stringify(metadata: dict[str, Any]) -> dict[str, Any]:
    # Keep the wire payload to plain JSON-safe values only.
    return {key: value for key, value in metadata.items()}


def _pending(db: Session) -> list[tuple[list[str], RealtimeEnvelope]]:
    return db.info.setdefault(_PENDING_EVENTS_KEY, [])  # type: ignore[no-any-return]


@event.listens_for(Session, "after_commit")
def _flush_after_commit(session: Session) -> None:
    pending: list[tuple[list[str], RealtimeEnvelope]] = session.info.pop(_PENDING_EVENTS_KEY, [])
    if not pending:
        return
    broker = get_broker()
    for channels, envelope in pending:
        message = envelope.model_dump_json()
        for channel in channels:
            broker.publish(channel, message)


@event.listens_for(Session, "after_rollback")
def _discard_after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_EVENTS_KEY, None)


@event.listens_for(Session, "after_soft_rollback")
def _discard_after_soft_rollback(session: Session, previous_transaction: object) -> None:
    # A rolled-back nested transaction (e.g. a failed flush inside a `with` block)
    # must not leave stale pending events queued for a later, unrelated commit.
    if not session.in_transaction():
        session.info.pop(_PENDING_EVENTS_KEY, None)
