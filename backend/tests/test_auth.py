from __future__ import annotations

from datetime import timedelta

import jwt
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.settings import get_settings
from app.domains.auth.models import RefreshToken, RefreshTokenRevocationReason, User
from app.domains.auth.security import hash_refresh_token, utc_now, verify_password

VALID_PASSWORD = "StrongPass123!"


def register_payload(email: str = "ada@example.com") -> dict[str, str]:
    return {"email": email, "password": VALID_PASSWORD, "display_name": "Ada Lovelace"}


def register_user(client: TestClient, email: str = "ada@example.com") -> dict[str, object]:
    response = client.post("/auth/register", json=register_payload(email))
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def test_registration_success(client: TestClient, db_session: Session) -> None:
    body = register_user(client)

    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    user_body = body["user"]
    assert isinstance(user_body, dict)
    assert user_body["email"] == "ada@example.com"
    user = db_session.scalar(select(User).where(User.email == "ada@example.com"))
    assert user is not None
    assert user.password_hash != VALID_PASSWORD
    assert verify_password(VALID_PASSWORD, user.password_hash)


def test_duplicate_registration(client: TestClient) -> None:
    register_user(client)
    response = client.post("/auth/register", json=register_payload())

    assert response.status_code == 409
    assert response.json()["detail"] == "Account already exists"


def test_weak_password_rejected(client: TestClient) -> None:
    response = client.post(
        "/auth/register",
        json={"email": "weak@example.com", "password": "password", "display_name": "Weak"},
    )

    assert response.status_code == 422


def test_valid_login(client: TestClient) -> None:
    register_user(client)

    response = client.post(
        "/auth/login", json={"email": "ada@example.com", "password": VALID_PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["access_token"]
    assert response.json()["refresh_token"]


def test_invalid_login_uses_safe_response(client: TestClient) -> None:
    register_user(client)

    response = client.post("/auth/login", json={"email": "ada@example.com", "password": "wrong"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_protected_endpoint_requires_access_token(client: TestClient) -> None:
    response = client.get("/auth/me")

    assert response.status_code == 401


def test_current_user_endpoint(client: TestClient) -> None:
    body = register_user(client)

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})

    assert response.status_code == 200
    assert response.json()["email"] == "ada@example.com"


def test_expired_access_token_rejected(client: TestClient) -> None:
    body = register_user(client)
    settings = get_settings()
    access_token = body["access_token"]
    assert isinstance(access_token, str)
    payload = jwt.decode(access_token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    payload["exp"] = utc_now() - timedelta(minutes=1)
    expired = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})

    assert response.status_code == 401


def test_refresh_token_success_and_rotation(client: TestClient, db_session: Session) -> None:
    body = register_user(client)
    original_refresh = str(body["refresh_token"])

    response = client.post("/auth/refresh", json={"refresh_token": original_refresh})

    assert response.status_code == 200
    rotated = response.json()["refresh_token"]
    assert rotated != original_refresh
    original_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(original_refresh))
    )
    rotated_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(rotated))
    )
    assert original_record is not None
    assert rotated_record is not None
    assert original_record.revoked_at is not None
    assert original_record.replaced_by_token_id == rotated_record.id
    assert rotated_record.parent_token_id == original_record.id
    assert original_record.family_id == rotated_record.family_id


def test_refresh_token_reuse_revokes_family(client: TestClient, db_session: Session) -> None:
    body = register_user(client)
    original_refresh = str(body["refresh_token"])
    rotated = client.post("/auth/refresh", json={"refresh_token": original_refresh}).json()
    assert isinstance(rotated, dict)
    rotated_refresh = rotated["refresh_token"]
    assert isinstance(rotated_refresh, str)

    response = client.post("/auth/refresh", json={"refresh_token": original_refresh})

    assert response.status_code == 401
    rotated_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(rotated_refresh))
    )
    assert rotated_record is not None
    assert rotated_record.revoked_at is not None
    assert rotated_record.revocation_reason == RefreshTokenRevocationReason.rotation_reuse


def test_revoked_refresh_token_rejected(client: TestClient) -> None:
    body = register_user(client)
    refresh_token = str(body["refresh_token"])
    logout = client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert logout.status_code == 200

    response = client.post("/auth/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 401


def test_logout_revokes_refresh_token(client: TestClient, db_session: Session) -> None:
    body = register_user(client)
    refresh_token = str(body["refresh_token"])

    response = client.post("/auth/logout", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    token_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(refresh_token))
    )
    assert token_record is not None
    assert token_record.revoked_at is not None
    assert token_record.revocation_reason == RefreshTokenRevocationReason.logout
