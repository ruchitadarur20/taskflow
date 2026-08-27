from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.auth.security import utc_now
from app.domains.notifications.models import Notification
from app.realtime.events import RealtimeEventType, queue_user_event


class NotificationError(Exception):
    pass


class NotificationNotFoundError(NotificationError):
    pass


def create_notification(
    db: Session,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    notification_type: str,
    title: str,
    body: str | None = None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> Notification:
    """Persist a notification and queue its realtime delivery.

    Does not commit: callers create notifications as part of a larger mutation
    (e.g. assigning a task) and own the transaction boundary, matching how
    `app.domains.projects.service.record_activity` is used.
    """
    now = utc_now()
    notification = Notification(
        user_id=user_id,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        type=notification_type,
        title=title,
        body=body,
        payload_json=payload or {},
        created_at=now,
    )
    db.add(notification)
    queue_user_event(
        db,
        user_id=user_id,
        workspace_id=workspace_id,
        event_type=RealtimeEventType.notification_created,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        occurred_at=now,
        data={"type": notification_type, "title": title},
    )
    return notification


def list_notifications(
    db: Session,
    user: User,
    *,
    workspace_id: uuid.UUID | None = None,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user.id)
    if workspace_id is not None:
        query = query.where(Notification.workspace_id == workspace_id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    return list(
        db.scalars(query.order_by(Notification.created_at.desc()).limit(limit).offset(offset))
    )


def unread_count(db: Session, user: User, *, workspace_id: uuid.UUID | None = None) -> int:
    query = select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None)
    )
    if workspace_id is not None:
        query = query.where(Notification.workspace_id == workspace_id)
    return db.scalar(query) or 0


def get_notification(db: Session, user: User, notification_id: uuid.UUID) -> Notification:
    notification = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if notification is None:
        raise NotificationNotFoundError
    return notification


def mark_read(db: Session, user: User, notification_id: uuid.UUID) -> Notification:
    notification = get_notification(db, user, notification_id)
    if notification.read_at is None:
        notification.read_at = utc_now()
        queue_user_event(
            db,
            user_id=user.id,
            workspace_id=notification.workspace_id,
            event_type=RealtimeEventType.notification_read,
            project_id=notification.project_id,
            task_id=notification.task_id,
            actor_id=user.id,
            occurred_at=notification.read_at,
            data={"notification_id": str(notification.id)},
        )
        db.commit()
        db.refresh(notification)
    return notification
