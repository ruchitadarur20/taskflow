from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.core.rate_limit import (
    enforce_http_rate_limit,
    login_rule,
    refresh_rule,
    register_rule,
    websocket_rule,
)
from app.core.settings import Settings, get_settings
from app.db.session import get_db
from app.domains.auth import service
from app.domains.auth.models import User
from app.domains.auth.schemas import (
    AuthTokenResponse,
    LoginRequest,
    LogoutRequest,
    LogoutResponse,
    RefreshRequest,
    RegisterRequest,
    UserRead,
    WebSocketTicketResponse,
)
from app.domains.auth.ws_tickets import WebSocketTicketError, issue_websocket_ticket

router = APIRouter(prefix="/auth", tags=["auth"])


def request_ip(request: Request) -> str | None:
    if request.client is None:
        return None
    return request.client.host


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthTokenResponse:
    enforce_http_rate_limit(request, register_rule(settings))
    try:
        access_token, refresh_token, access_expires_at, user = service.register(
            db,
            str(payload.email),
            payload.password,
            payload.display_name,
            settings,
            user_agent=request.headers.get("user-agent"),
            ip_address=request_ip(request),
        )
    except service.DuplicateUserError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Account already exists"
        ) from None
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_at=access_expires_at,
        user=UserRead.model_validate(user),
    )


@router.post("/login", response_model=AuthTokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthTokenResponse:
    enforce_http_rate_limit(request, login_rule(settings))
    try:
        access_token, refresh_token, access_expires_at, user = service.login(
            db,
            str(payload.email),
            payload.password,
            settings,
            user_agent=request.headers.get("user-agent"),
            ip_address=request_ip(request),
        )
    except service.InvalidCredentialsError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        ) from None
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_at=access_expires_at,
        user=UserRead.model_validate(user),
    )


@router.post("/refresh", response_model=AuthTokenResponse)
def refresh(
    payload: RefreshRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthTokenResponse:
    enforce_http_rate_limit(request, refresh_rule(settings))
    try:
        access_token, refresh_token, access_expires_at, user = service.refresh(
            db,
            payload.refresh_token,
            settings,
            user_agent=request.headers.get("user-agent"),
            ip_address=request_ip(request),
        )
    except service.RefreshTokenReuseError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked"
        ) from None
    except service.InvalidRefreshTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from None
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_at=access_expires_at,
        user=UserRead.model_validate(user),
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(payload: LogoutRequest, db: Annotated[Session, Depends(get_db)]) -> LogoutResponse:
    service.logout(db, payload.refresh_token)
    return LogoutResponse(detail="Logged out")


@router.get("/me", response_model=UserRead)
def me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return current_user


@router.post("/ws-ticket", response_model=WebSocketTicketResponse)
def websocket_ticket(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> WebSocketTicketResponse:
    enforce_http_rate_limit(request, websocket_rule(settings))
    try:
        ticket, expires_at = issue_websocket_ticket(current_user.id, settings)
    except WebSocketTicketError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Realtime authentication is temporarily unavailable",
        ) from None
    return WebSocketTicketResponse(ticket=ticket, expires_at=expires_at)
