from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.settings import Settings
from app.domains.auth.models import RefreshToken, RefreshTokenRevocationReason, User, UserStatus
from app.domains.auth.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    utc_now,
    verify_password,
)


class AuthError(Exception):
    pass


class DuplicateUserError(AuthError):
    pass


class InvalidCredentialsError(AuthError):
    pass


class InvalidRefreshTokenError(AuthError):
    pass


class RefreshTokenReuseError(AuthError):
    pass


def normalize_email(email: str) -> str:
    return email.strip().lower()


def as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == normalize_email(email)))


def create_user(db: Session, email: str, password: str, display_name: str) -> User:
    if get_user_by_email(db, email) is not None:
        raise DuplicateUserError
    now = utc_now()
    user = User(
        email=normalize_email(email),
        password_hash=hash_password(password),
        display_name=display_name.strip(),
        status=UserStatus.active,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def issue_token_pair(
    db: Session,
    user: User,
    settings: Settings,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
    family_id: uuid.UUID | None = None,
    parent_token_id: uuid.UUID | None = None,
) -> tuple[str, str, object, RefreshToken]:
    refresh_token = new_refresh_token()
    now = utc_now()
    record = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        family_id=family_id or uuid.uuid4(),
        parent_token_id=parent_token_id,
        expires_at=now + timedelta(days=settings.refresh_token_expires_days),
        user_agent=user_agent,
        ip_address=ip_address,
        created_at=now,
    )
    db.add(record)
    db.flush()
    access_token, access_expires_at = create_access_token(user.id, settings)
    return access_token, refresh_token, access_expires_at, record


def authenticate_user(db: Session, email: str, password: str) -> User:
    user = get_user_by_email(db, email)
    if (
        user is None
        or user.status != UserStatus.active
        or not verify_password(password, user.password_hash)
    ):
        raise InvalidCredentialsError
    user.last_login_at = utc_now()
    user.updated_at = utc_now()
    db.commit()
    db.refresh(user)
    return user


def login(
    db: Session,
    email: str,
    password: str,
    settings: Settings,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str, object, User]:
    user = authenticate_user(db, email, password)
    access_token, refresh_token, access_expires_at, _ = issue_token_pair(
        db, user, settings, user_agent=user_agent, ip_address=ip_address
    )
    db.commit()
    return access_token, refresh_token, access_expires_at, user


def register(
    db: Session,
    email: str,
    password: str,
    display_name: str,
    settings: Settings,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str, object, User]:
    user = create_user(db, email, password, display_name)
    access_token, refresh_token, access_expires_at, _ = issue_token_pair(
        db, user, settings, user_agent=user_agent, ip_address=ip_address
    )
    db.commit()
    return access_token, refresh_token, access_expires_at, user


def refresh(
    db: Session,
    token: str,
    settings: Settings,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str, object, User]:
    token_hash = hash_refresh_token(token)
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    now = utc_now()
    if record is None:
        raise InvalidRefreshTokenError
    if record.revoked_at is not None:
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == record.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now, revocation_reason=RefreshTokenRevocationReason.rotation_reuse)
        )
        db.commit()
        raise RefreshTokenReuseError
    if as_aware_utc(record.expires_at) <= now:
        record.revoked_at = now
        record.revocation_reason = RefreshTokenRevocationReason.expired
        db.commit()
        raise InvalidRefreshTokenError
    if record.user.status != UserStatus.active:
        raise InvalidRefreshTokenError

    record.revoked_at = now
    record.revocation_reason = RefreshTokenRevocationReason.rotated
    record.last_used_at = now
    access_token, refresh_token, access_expires_at, next_record = issue_token_pair(
        db,
        record.user,
        settings,
        user_agent=user_agent,
        ip_address=ip_address,
        family_id=record.family_id,
        parent_token_id=record.id,
    )
    db.flush()
    record.replaced_by_token_id = next_record.id
    db.commit()
    return access_token, refresh_token, access_expires_at, record.user


def logout(db: Session, token: str) -> None:
    token_hash = hash_refresh_token(token)
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if record is None:
        return
    if record.revoked_at is None:
        record.revoked_at = utc_now()
        record.revocation_reason = RefreshTokenRevocationReason.logout
        db.commit()
