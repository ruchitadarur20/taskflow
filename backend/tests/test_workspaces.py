from __future__ import annotations

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.workspaces.models import WorkspaceMember, WorkspaceRole, WorkspaceStatus

VALID_PASSWORD = "StrongPass123!"


def register(client: TestClient, email: str) -> dict[str, object]:
    response = client.post(
        "/auth/register",
        json={"email": email, "password": VALID_PASSWORD, "display_name": email.split("@")[0]},
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def auth_header(body: dict[str, object]) -> dict[str, str]:
    token = body["access_token"]
    assert isinstance(token, str)
    return {"Authorization": f"Bearer {token}"}


def create_workspace(
    client: TestClient, user: dict[str, object], name: str = "Acme"
) -> dict[str, object]:
    response = client.post("/workspaces", json={"name": name}, headers=auth_header(user))
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def user_id(user: dict[str, object]) -> str:
    user_body = user["user"]
    assert isinstance(user_body, dict)
    value = user_body["id"]
    assert isinstance(value, str)
    return value


def add_member(
    client: TestClient,
    owner: dict[str, object],
    workspace_id: str,
    email: str,
    role: str,
) -> dict[str, object]:
    response = client.post(
        f"/workspaces/{workspace_id}/members",
        json={"email": email, "role": role},
        headers=auth_header(owner),
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def test_workspace_creation_creates_owner_membership(
    client: TestClient, db_session: Session
) -> None:
    owner = register(client, "owner@example.com")
    workspace = create_workspace(client, owner)

    assert workspace["name"] == "Acme"
    assert workspace["current_user_role"] == "owner"
    membership = db_session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == UUID(str(workspace["id"])),
            WorkspaceMember.user_id == UUID(user_id(owner)),
        )
    )
    assert membership is not None
    assert membership.role == WorkspaceRole.owner


def test_workspace_listing_scoped_to_user(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    create_workspace(client, owner, "Owner Space")
    create_workspace(client, other, "Other Space")

    response = client.get("/workspaces", headers=auth_header(owner))

    assert response.status_code == 200
    names = [workspace["name"] for workspace in response.json()]
    assert names == ["Owner Space"]


def test_non_member_access_denied(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    stranger = register(client, "stranger@example.com")
    workspace = create_workspace(client, owner)

    response = client.get(f"/workspaces/{workspace['id']}", headers=auth_header(stranger))

    assert response.status_code == 404


def test_owner_can_update_and_archive_workspace(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    workspace = create_workspace(client, owner)

    update = client.patch(
        f"/workspaces/{workspace['id']}",
        json={"name": "Renamed"},
        headers=auth_header(owner),
    )
    archive = client.delete(f"/workspaces/{workspace['id']}", headers=auth_header(owner))
    listing = client.get("/workspaces", headers=auth_header(owner))

    assert update.status_code == 200
    assert update.json()["name"] == "Renamed"
    assert archive.status_code == 204
    assert listing.status_code == 200
    assert listing.json() == []


def test_admin_can_update_and_manage_non_owner_members(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    admin = register(client, "admin@example.com")
    member = register(client, "member@example.com")
    workspace = create_workspace(client, owner)
    add_member(client, owner, str(workspace["id"]), "admin@example.com", "admin")

    update = client.patch(
        f"/workspaces/{workspace['id']}",
        json={"name": "Admin Edited"},
        headers=auth_header(admin),
    )
    added = client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": "member@example.com", "role": "viewer"},
        headers=auth_header(admin),
    )
    changed = client.patch(
        f"/workspaces/{workspace['id']}/members/{user_id(member)}",
        json={"role": "member"},
        headers=auth_header(admin),
    )

    assert update.status_code == 200
    assert added.status_code == 201
    assert changed.status_code == 200
    assert changed.json()["role"] == "member"


def test_member_and_viewer_restrictions(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    viewer = register(client, "viewer@example.com")
    workspace = create_workspace(client, owner)
    add_member(client, owner, str(workspace["id"]), "member@example.com", "member")
    add_member(client, owner, str(workspace["id"]), "viewer@example.com", "viewer")

    member_update = client.patch(
        f"/workspaces/{workspace['id']}",
        json={"name": "Nope"},
        headers=auth_header(member),
    )
    viewer_members = client.get(
        f"/workspaces/{workspace['id']}/members", headers=auth_header(viewer)
    )
    viewer_add = client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": "member@example.com", "role": "member"},
        headers=auth_header(viewer),
    )

    assert member_update.status_code == 403
    assert viewer_members.status_code == 200
    assert viewer_add.status_code == 403


def test_duplicate_membership_rejected(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    workspace = create_workspace(client, owner)
    add_member(client, owner, str(workspace["id"]), "member@example.com", "member")

    response = client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": "member@example.com", "role": "viewer"},
        headers=auth_header(owner),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Membership already exists"
    assert user_id(member)


def test_admin_cannot_take_over_owner_role_or_remove_owner(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    admin = register(client, "admin@example.com")
    member = register(client, "member@example.com")
    workspace = create_workspace(client, owner)
    add_member(client, owner, str(workspace["id"]), "admin@example.com", "admin")
    add_member(client, owner, str(workspace["id"]), "member@example.com", "member")

    promote = client.patch(
        f"/workspaces/{workspace['id']}/members/{user_id(member)}",
        json={"role": "owner"},
        headers=auth_header(admin),
    )
    demote_owner = client.patch(
        f"/workspaces/{workspace['id']}/members/{user_id(owner)}",
        json={"role": "admin"},
        headers=auth_header(admin),
    )
    remove_owner = client.delete(
        f"/workspaces/{workspace['id']}/members/{user_id(owner)}",
        headers=auth_header(admin),
    )

    assert promote.status_code == 403
    assert demote_owner.status_code == 403
    assert remove_owner.status_code == 403


def test_final_owner_protection(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    workspace = create_workspace(client, owner)

    demote = client.patch(
        f"/workspaces/{workspace['id']}/members/{user_id(owner)}",
        json={"role": "admin"},
        headers=auth_header(owner),
    )
    remove = client.delete(
        f"/workspaces/{workspace['id']}/members/{user_id(owner)}",
        headers=auth_header(owner),
    )

    assert demote.status_code == 409
    assert remove.status_code == 409


def test_cross_workspace_isolation(client: TestClient) -> None:
    owner_a = register(client, "a@example.com")
    owner_b = register(client, "b@example.com")
    member = register(client, "member@example.com")
    workspace_a = create_workspace(client, owner_a, "A")
    workspace_b = create_workspace(client, owner_b, "B")
    add_member(client, owner_a, str(workspace_a["id"]), "member@example.com", "admin")

    update_other = client.patch(
        f"/workspaces/{workspace_b['id']}",
        json={"name": "Stolen"},
        headers=auth_header(member),
    )
    add_to_other = client.post(
        f"/workspaces/{workspace_b['id']}/members",
        json={"email": "member@example.com", "role": "member"},
        headers=auth_header(member),
    )

    assert update_other.status_code == 404
    assert add_to_other.status_code == 404


def test_archived_workspace_rejects_mutations(client: TestClient, db_session: Session) -> None:
    owner = register(client, "owner@example.com")
    workspace = create_workspace(client, owner)
    archive = client.delete(f"/workspaces/{workspace['id']}", headers=auth_header(owner))
    assert archive.status_code == 204

    response = client.patch(
        f"/workspaces/{workspace['id']}",
        json={"name": "Archived"},
        headers=auth_header(owner),
    )

    assert response.status_code == 409
    stored = db_session.get(WorkspaceMember, UUID(str(workspace["id"])))
    assert stored is None
    workspace_members = db_session.scalars(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == UUID(str(workspace["id"])))
    ).all()
    assert len(workspace_members) == 1
    assert workspace_members[0].workspace.status == WorkspaceStatus.archived
