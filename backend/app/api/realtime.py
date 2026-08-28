from __future__ import annotations

import logging
import uuid
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.core.rate_limit import websocket_rate_limited, websocket_rule
from app.core.settings import get_settings
from app.db.session import get_db
from app.domains.auth.models import User, UserStatus
from app.domains.auth.security import decode_access_token
from app.domains.auth.ws_tickets import WebSocketTicketError, consume_websocket_ticket
from app.domains.projects.service import ProjectError, get_project_for_user
from app.domains.workspaces.service import WorkspaceError, get_workspace_for_user
from app.realtime.channels import project_channel, user_channel, workspace_channel
from app.realtime.connection_manager import connection_manager

logger = logging.getLogger("app.realtime")

router = APIRouter(tags=["realtime"])

# WebSocket close codes in the private-use range 4000-4999 (RFC 6455 3.2).
WS_UNAUTHENTICATED = 4401
WS_FORBIDDEN = 4403
WS_RATE_LIMITED = 4408


class SubscribeMessage(BaseModel):
    action: str
    scope: str
    workspace_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None


def _authenticate(db: Session, token: str) -> User | None:
    settings = get_settings()
    try:
        user_id = decode_access_token(token, settings)
    except (jwt.PyJWTError, ValueError):
        return None
    user = db.get(User, user_id)
    if user is None or user.status != UserStatus.active:
        return None
    return user


def _authenticate_ticket(db: Session, ticket: str) -> User | None:
    settings = get_settings()
    try:
        user_id = consume_websocket_ticket(ticket, settings)
    except WebSocketTicketError:
        return None
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None or user.status != UserStatus.active:
        return None
    return user


async def _handle_subscribe(
    db: Session, user: User, message: SubscribeMessage
) -> tuple[str, str] | tuple[None, str]:
    """Validate a subscribe/unsubscribe request against RBAC.

    Returns (channel, scope_label) on success, or (None, reason) on denial.
    Membership/authorization checks are delegated entirely to the same service
    functions the REST API uses - no bespoke authorization logic lives here.
    """
    if message.scope == "workspace":
        if message.workspace_id is None:
            return None, "workspace_id is required"
        try:
            get_workspace_for_user(db, message.workspace_id, user)
        except WorkspaceError:
            return None, "not authorized for this workspace"
        return workspace_channel(message.workspace_id), "workspace"

    if message.scope == "project":
        if message.workspace_id is None or message.project_id is None:
            return None, "workspace_id and project_id are required"
        try:
            get_project_for_user(db, message.workspace_id, message.project_id, user)
        except (WorkspaceError, ProjectError):
            return None, "not authorized for this project"
        return project_channel(message.project_id), "project"

    return None, f"unknown scope '{message.scope}'"


@router.websocket("/ws")
async def realtime_ws(
    websocket: WebSocket,
    db: Annotated[Session, Depends(get_db)],
    ticket: str = "",
    token: str = "",
) -> None:
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.cors_allowed_origins:
        logger.info(
            "websocket origin rejected",
            extra={"component": "realtime", "event": "websocket.origin_rejected"},
        )
        await websocket.close(code=WS_FORBIDDEN)
        return
    if await websocket_rate_limited(websocket, websocket_rule(settings)):
        logger.info(
            "websocket connection rate limited",
            extra={"component": "realtime", "event": "websocket.rate_limited"},
        )
        await websocket.close(code=WS_RATE_LIMITED)
        return
    if not ticket and not token:
        await websocket.close(code=WS_UNAUTHENTICATED)
        return

    user = _authenticate_ticket(db, ticket) if ticket else _authenticate(db, token)
    if user is None:
        await websocket.close(code=WS_UNAUTHENTICATED)
        return

    await websocket.accept()
    personal_channel = user_channel(user.id)
    await connection_manager.subscribe(personal_channel, websocket)
    await websocket.send_json({"type": "connected", "user_id": str(user.id)})

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                message = SubscribeMessage.model_validate(raw)
            except ValidationError:
                await websocket.send_json({"type": "error", "reason": "invalid message"})
                continue

            if message.action == "subscribe":
                channel, label = await _handle_subscribe(db, user, message)
                if channel is None:
                    await websocket.send_json({"type": "error", "reason": label})
                    continue
                await connection_manager.subscribe(channel, websocket)
                await websocket.send_json(
                    {"type": "subscribed", "scope": label, "channel": channel}
                )
            elif message.action == "unsubscribe":
                channel, label = await _handle_subscribe(db, user, message)
                if channel is None:
                    await websocket.send_json({"type": "error", "reason": label})
                    continue
                await connection_manager.unsubscribe(channel, websocket)
                await websocket.send_json(
                    {"type": "unsubscribed", "scope": label, "channel": channel}
                )
            else:
                await websocket.send_json(
                    {"type": "error", "reason": f"unknown action '{message.action}'"}
                )
    except WebSocketDisconnect:
        pass
    finally:
        await connection_manager.remove(websocket)
