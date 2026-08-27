from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.db.session import get_db
from app.domains.auth.models import User
from app.domains.notifications import service
from app.domains.notifications.models import Notification
from app.domains.notifications.schemas import NotificationRead, UnreadCountRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


def notification_response(notification: Notification) -> NotificationRead:
    return NotificationRead.model_validate(notification)


@router.get("", response_model=list[NotificationRead])
def list_notifications(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    workspace_id: uuid.UUID | None = None,
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[NotificationRead]:
    notifications = service.list_notifications(
        db,
        current_user,
        workspace_id=workspace_id,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )
    return [notification_response(notification) for notification in notifications]


@router.get("/unread-count", response_model=UnreadCountRead)
def get_unread_count(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    workspace_id: uuid.UUID | None = None,
) -> UnreadCountRead:
    count = service.unread_count(db, current_user, workspace_id=workspace_id)
    return UnreadCountRead(unread_count=count)


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotificationRead:
    try:
        notification = service.mark_read(db, current_user, notification_id)
    except service.NotificationNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        ) from None
    return notification_response(notification)
