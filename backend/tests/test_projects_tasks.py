from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

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


def auth_header(user: dict[str, object]) -> dict[str, str]:
    token = user["access_token"]
    assert isinstance(token, str)
    return {"Authorization": f"Bearer {token}"}


def user_id(user: dict[str, object]) -> str:
    body = user["user"]
    assert isinstance(body, dict)
    value = body["id"]
    assert isinstance(value, str)
    return value


def workspace(client: TestClient, user: dict[str, object], name: str = "Acme") -> dict[str, object]:
    response = client.post("/workspaces", json={"name": name}, headers=auth_header(user))
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def add_member(
    client: TestClient, owner: dict[str, object], workspace_id: str, email: str, role: str
) -> None:
    response = client.post(
        f"/workspaces/{workspace_id}/members",
        json={"email": email, "role": role},
        headers=auth_header(owner),
    )
    assert response.status_code == 201


def project(
    client: TestClient, actor: dict[str, object], workspace_id: str, name: str = "Launch"
) -> dict[str, object]:
    response = client.post(
        f"/workspaces/{workspace_id}/projects",
        json={"name": name, "description": "Ship it"},
        headers=auth_header(actor),
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def task(
    client: TestClient,
    actor: dict[str, object],
    workspace_id: str,
    project_id: str,
    title: str = "Task",
    **extra: object,
) -> dict[str, object]:
    response = client.post(
        f"/workspaces/{workspace_id}/projects/{project_id}/tasks",
        json={"title": title, **extra},
        headers=auth_header(actor),
    )
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body, dict)
    return body


def test_project_lifecycle_and_listing_scope(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    ws = workspace(client, owner)
    other_ws = workspace(client, other, "Other")
    created = project(client, owner, str(ws["id"]))
    project(client, other, str(other_ws["id"]), "Private")

    listing = client.get(f"/workspaces/{ws['id']}/projects", headers=auth_header(owner))
    outsider = client.get(f"/workspaces/{ws['id']}/projects", headers=auth_header(other))
    update = client.patch(
        f"/workspaces/{ws['id']}/projects/{created['id']}",
        json={"name": "Renamed"},
        headers=auth_header(owner),
    )
    archive = client.delete(
        f"/workspaces/{ws['id']}/projects/{created['id']}", headers=auth_header(owner)
    )

    assert listing.status_code == 200
    assert [item["name"] for item in listing.json()] == ["Launch"]
    assert outsider.status_code == 404
    assert update.status_code == 200
    assert update.json()["name"] == "Renamed"
    assert archive.status_code == 204


def test_task_creation_update_assignment_priority_due_date(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "member@example.com", "member")
    proj = project(client, owner, str(ws["id"]))
    due_at = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    created = task(
        client,
        owner,
        str(ws["id"]),
        str(proj["id"]),
        "Draft plan",
        priority="high",
        assignee_id=user_id(member),
        due_at=due_at,
    )

    response = client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created['id']}",
        json={"status": "in_progress", "priority": "urgent", "title": "Draft better plan"},
        headers=auth_header(member),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"
    assert response.json()["priority"] == "urgent"
    assert response.json()["assignee_id"] == user_id(member)
    assert response.json()["due_at"] is not None


def test_invalid_assignment_and_viewer_restrictions(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    viewer = register(client, "viewer@example.com")
    outsider = register(client, "outsider@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "viewer@example.com", "viewer")
    proj = project(client, owner, str(ws["id"]))

    bad_assignment = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks",
        json={"title": "Nope", "assignee_id": user_id(outsider)},
        headers=auth_header(owner),
    )
    viewer_create = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks",
        json={"title": "Read only"},
        headers=auth_header(viewer),
    )
    viewer_list = client.get(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks",
        headers=auth_header(viewer),
    )

    assert bad_assignment.status_code == 422
    assert viewer_create.status_code == 403
    assert viewer_list.status_code == 200


def test_subtasks_reject_cross_project_and_cycles(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))
    other_project = project(client, owner, str(ws["id"]), "Other")
    parent = task(client, owner, str(ws["id"]), str(proj["id"]), "Parent")
    child = task(
        client,
        owner,
        str(ws["id"]),
        str(proj["id"]),
        "Child",
        parent_task_id=parent["id"],
    )
    other_task = task(client, owner, str(ws["id"]), str(other_project["id"]), "Other")

    cross_project = client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{child['id']}",
        json={"parent_task_id": other_task["id"]},
        headers=auth_header(owner),
    )
    cycle = client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{parent['id']}",
        json={"parent_task_id": child["id"]},
        headers=auth_header(owner),
    )

    assert cross_project.status_code == 404
    assert cycle.status_code == 422


def test_dependencies_reject_self_duplicate_and_cycles(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))
    first = task(client, owner, str(ws["id"]), str(proj["id"]), "First")
    second = task(client, owner, str(ws["id"]), str(proj["id"]), "Second")

    self_dep = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{first['id']}/dependencies",
        json={"blocking_task_id": first["id"]},
        headers=auth_header(owner),
    )
    created = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{second['id']}/dependencies",
        json={"blocking_task_id": first["id"]},
        headers=auth_header(owner),
    )
    duplicate = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{second['id']}/dependencies",
        json={"blocking_task_id": first["id"]},
        headers=auth_header(owner),
    )
    cycle = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{first['id']}/dependencies",
        json={"blocking_task_id": second["id"]},
        headers=auth_header(owner),
    )

    assert self_dep.status_code == 422
    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert cycle.status_code == 422


def test_labels_and_cross_workspace_label_isolation(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    ws = workspace(client, owner)
    other_ws = workspace(client, other, "Other")
    proj = project(client, owner, str(ws["id"]))
    other_proj = project(client, other, str(other_ws["id"]))
    created_task = task(client, owner, str(ws["id"]), str(proj["id"]), "Label me")
    other_label = client.post(
        f"/workspaces/{other_ws['id']}/projects/{other_proj['id']}/labels",
        json={"name": "Other", "color": "#123456"},
        headers=auth_header(other),
    ).json()
    label = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/labels",
        json={"name": "Bug", "color": "#ff0000"},
        headers=auth_header(owner),
    )
    duplicate = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/labels",
        json={"name": "Bug", "color": "#00ff00"},
        headers=auth_header(owner),
    )
    attached = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}/labels",
        json={"label_id": label.json()["id"]},
        headers=auth_header(owner),
    )
    cross_label = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}/labels",
        json={"label_id": other_label["id"]},
        headers=auth_header(owner),
    )

    assert label.status_code == 201
    assert duplicate.status_code == 409
    assert attached.status_code == 200
    assert attached.json()[0]["name"] == "Bug"
    assert cross_label.status_code == 404


def test_comments_and_comment_authorization(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    viewer = register(client, "viewer@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "member@example.com", "member")
    add_member(client, owner, str(ws["id"]), "viewer@example.com", "viewer")
    proj = project(client, owner, str(ws["id"]))
    created_task = task(client, member, str(ws["id"]), str(proj["id"]), "Discuss")

    comment = client.post(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}/comments",
        json={"body": "First"},
        headers=auth_header(member),
    )
    viewer_edit = client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}/comments/{comment.json()['id']}",
        json={"body": "No"},
        headers=auth_header(viewer),
    )
    owner_edit = client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}/comments/{comment.json()['id']}",
        json={"body": "Moderated"},
        headers=auth_header(owner),
    )

    assert comment.status_code == 201
    assert viewer_edit.status_code == 403
    assert owner_edit.status_code == 200
    assert owner_edit.json()["body"] == "Moderated"


def test_activity_history_and_task_archive(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))
    created_task = task(client, owner, str(ws["id"]), str(proj["id"]), "Trace")
    client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}",
        json={"status": "done"},
        headers=auth_header(owner),
    )
    archive = client.delete(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created_task['id']}",
        headers=auth_header(owner),
    )
    activity = client.get(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/activity",
        headers=auth_header(owner),
    )

    assert archive.status_code == 204
    assert activity.status_code == 200
    event_types = [event["event_type"] for event in activity.json()]
    assert "project.created" in event_types
    assert "task.created" in event_types
    assert "task.status_changed" in event_types
    assert "task.archived" in event_types
