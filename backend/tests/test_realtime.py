from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.realtime.broker import RealtimeBroker, RedisBroker, reset_broker, set_broker
from app.realtime.channels import project_channel, user_channel, workspace_channel
from app.realtime.events import queue_workspace_event

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


def token_of(user: dict[str, object]) -> str:
    value = user["access_token"]
    assert isinstance(value, str)
    return value


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
        json={"name": name},
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


# --- Authentication -----------------------------------------------------------


def test_ws_rejects_missing_token(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws"):
            pass


def test_ws_rejects_invalid_token(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?token=not-a-real-token"):
            pass


def test_ws_accepts_valid_token_and_acks_connection(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    with client.websocket_connect(f"/ws?token={token_of(owner)}") as ws:
        hello = ws.receive_json()
        assert hello == {"type": "connected", "user_id": user_id(owner)}


def test_ws_ticket_endpoint_issues_one_time_ticket(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = register(client, "owner@example.com")

    def issue_ticket(user_uuid: uuid.UUID, settings: object) -> tuple[str, datetime]:
        assert str(user_uuid) == user_id(owner)
        return "ticket-" + "x" * 40, datetime(2026, 1, 1, tzinfo=UTC)

    monkeypatch.setattr("app.api.auth.issue_websocket_ticket", issue_ticket)

    response = client.post("/auth/ws-ticket", headers=auth_header(owner))

    assert response.status_code == 200
    assert response.json() == {
        "ticket": "ticket-" + "x" * 40,
        "expires_at": "2026-01-01T00:00:00Z",
    }


def test_ws_accepts_ticket_once_and_rejects_replay(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = register(client, "owner@example.com")
    tickets = {"ticket-once": uuid.UUID(user_id(owner))}

    def consume_ticket(ticket: str, settings: object) -> uuid.UUID | None:
        return tickets.pop(ticket, None)

    monkeypatch.setattr("app.api.realtime.consume_websocket_ticket", consume_ticket)

    with client.websocket_connect("/ws?ticket=ticket-once") as ws:
        assert ws.receive_json() == {"type": "connected", "user_id": user_id(owner)}

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws?ticket=ticket-once"):
            pass

    assert exc_info.value.code == 4401


# --- Subscription authorization ------------------------------------------------


def test_workspace_subscribe_requires_membership(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    outsider = register(client, "outsider@example.com")
    ws = workspace(client, owner)

    with client.websocket_connect(f"/ws?token={token_of(owner)}") as socket:
        socket.receive_json()
        socket.send_json({"action": "subscribe", "scope": "workspace", "workspace_id": ws["id"]})
        assert socket.receive_json()["type"] == "subscribed"

    with client.websocket_connect(f"/ws?token={token_of(outsider)}") as socket:
        socket.receive_json()
        socket.send_json({"action": "subscribe", "scope": "workspace", "workspace_id": ws["id"]})
        reply = socket.receive_json()
        assert reply["type"] == "error"


def test_project_subscribe_requires_authorized_workspace(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    outsider = register(client, "outsider@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))

    with client.websocket_connect(f"/ws?token={token_of(outsider)}") as socket:
        socket.receive_json()
        socket.send_json(
            {
                "action": "subscribe",
                "scope": "project",
                "workspace_id": ws["id"],
                "project_id": proj["id"],
            }
        )
        assert socket.receive_json()["type"] == "error"


def test_project_subscribe_rejects_project_from_another_workspace(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    other_ws = workspace(client, owner, "Other")
    other_proj = project(client, owner, str(other_ws["id"]), "Other project")

    with client.websocket_connect(f"/ws?token={token_of(owner)}") as socket:
        socket.receive_json()
        # workspace_id/project_id mismatch: project does not belong to workspace ws.
        socket.send_json(
            {
                "action": "subscribe",
                "scope": "project",
                "workspace_id": ws["id"],
                "project_id": other_proj["id"],
            }
        )
        reply = socket.receive_json()
        assert reply["type"] == "error"


def test_subscribe_unknown_scope_is_rejected(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    with client.websocket_connect(f"/ws?token={token_of(owner)}") as socket:
        socket.receive_json()
        socket.send_json(
            {"action": "subscribe", "scope": "planet", "workspace_id": str(uuid.uuid4())}
        )
        reply = socket.receive_json()
        assert reply["type"] == "error"


# --- Event publication & fanout -------------------------------------------------


def test_project_created_event_delivered_to_workspace_subscriber(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)

    with client.websocket_connect(f"/ws?token={token_of(owner)}") as socket:
        socket.receive_json()
        socket.send_json({"action": "subscribe", "scope": "workspace", "workspace_id": ws["id"]})
        socket.receive_json()

        created = project(client, owner, str(ws["id"]))

        event = socket.receive_json()
        assert event["event_type"] == "project.created"
        assert event["workspace_id"] == ws["id"]
        assert event["project_id"] == created["id"]
        assert event["actor_id"] == user_id(owner)


def test_task_events_do_not_leak_to_other_workspace_subscriber(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    other = register(client, "other@example.com")
    other_ws = workspace(client, other, "Other")
    proj = project(client, owner, str(ws["id"]))

    with client.websocket_connect(f"/ws?token={token_of(other)}") as other_socket:
        other_socket.receive_json()
        other_socket.send_json(
            {"action": "subscribe", "scope": "workspace", "workspace_id": other_ws["id"]}
        )
        other_socket.receive_json()

        task(client, owner, str(ws["id"]), str(proj["id"]), "Should not leak")
        # A distinguishable, legitimate event for `other_ws` sent right after: if the
        # leaked `ws` event had been delivered, it would arrive before this one.
        project(client, other, str(other_ws["id"]), "Legit")

        event = other_socket.receive_json()
        assert event["workspace_id"] == other_ws["id"]
        assert event["event_type"] == "project.created"


def test_task_created_event_reaches_project_scoped_subscriber(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)
    proj = project(client, owner, str(ws["id"]))

    with client.websocket_connect(f"/ws?token={token_of(owner)}") as socket:
        socket.receive_json()
        socket.send_json(
            {
                "action": "subscribe",
                "scope": "project",
                "workspace_id": ws["id"],
                "project_id": proj["id"],
            }
        )
        socket.receive_json()

        created = task(client, owner, str(ws["id"]), str(proj["id"]), "Ship it")

        event = socket.receive_json()
        assert event["event_type"] == "task.created"
        assert event["task_id"] == created["id"]


def test_duplicate_subscribe_does_not_duplicate_delivery(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    ws = workspace(client, owner)

    with client.websocket_connect(f"/ws?token={token_of(owner)}") as socket:
        socket.receive_json()
        # Subscribing twice (e.g. a client resubscribing after reconnect logic
        # runs twice) must not register the socket on the channel twice.
        socket.send_json({"action": "subscribe", "scope": "workspace", "workspace_id": ws["id"]})
        socket.receive_json()
        socket.send_json({"action": "subscribe", "scope": "workspace", "workspace_id": ws["id"]})
        socket.receive_json()

        project(client, owner, str(ws["id"]), "First")
        project(client, owner, str(ws["id"]), "Second")

        first = socket.receive_json()
        second = socket.receive_json()
        # If subscribing twice had registered the socket twice, the first
        # project's event would be delivered twice before the second ever
        # appears; instead each project produces exactly one frame, in order.
        assert first["data"]["name"] == "First"
        assert second["data"]["name"] == "Second"


# --- Notifications over the personal channel ------------------------------------


def test_assignee_change_notifies_assignee_over_personal_channel(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "member@example.com", "member")
    proj = project(client, owner, str(ws["id"]))
    created = task(client, owner, str(ws["id"]), str(proj["id"]), "Assign me")

    with client.websocket_connect(f"/ws?token={token_of(member)}") as socket:
        socket.receive_json()

        client.patch(
            f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created['id']}",
            json={"assignee_id": user_id(member)},
            headers=auth_header(owner),
        )

        event = socket.receive_json()
        assert event["event_type"] == "notification.created"
        assert event["data"]["type"] == "task.assignee_changed"


def test_notification_list_unread_count_and_mark_read(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "member@example.com", "member")
    proj = project(client, owner, str(ws["id"]))
    created = task(
        client, owner, str(ws["id"]), str(proj["id"]), "Assign me", assignee_id=user_id(member)
    )

    client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created['id']}",
        json={"status": "in_progress"},
        headers=auth_header(owner),
    )

    unread = client.get("/notifications/unread-count", headers=auth_header(member))
    assert unread.status_code == 200
    assert unread.json()["unread_count"] == 1

    listing = client.get("/notifications", headers=auth_header(member))
    assert listing.status_code == 200
    notifications = listing.json()
    assert len(notifications) == 1
    assert notifications[0]["type"] == "task.status_changed"

    mark_read = client.post(
        f"/notifications/{notifications[0]['id']}/read", headers=auth_header(member)
    )
    assert mark_read.status_code == 200
    assert mark_read.json()["read_at"] is not None

    unread_after = client.get("/notifications/unread-count", headers=auth_header(member))
    assert unread_after.json()["unread_count"] == 0


def test_mark_read_rejects_another_users_notification(client: TestClient) -> None:
    owner = register(client, "owner@example.com")
    member = register(client, "member@example.com")
    outsider = register(client, "outsider@example.com")
    ws = workspace(client, owner)
    add_member(client, owner, str(ws["id"]), "member@example.com", "member")
    proj = project(client, owner, str(ws["id"]))
    created = task(
        client, owner, str(ws["id"]), str(proj["id"]), "Assign me", assignee_id=user_id(member)
    )
    client.patch(
        f"/workspaces/{ws['id']}/projects/{proj['id']}/tasks/{created['id']}",
        json={"status": "done"},
        headers=auth_header(owner),
    )
    notification_id = client.get("/notifications", headers=auth_header(member)).json()[0]["id"]

    response = client.post(f"/notifications/{notification_id}/read", headers=auth_header(outsider))
    assert response.status_code == 404


# --- Broker/adapter abstraction (no live Redis, no websocket transport) --------


class RecordingBroker:
    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))


def test_broker_protocol_is_satisfied_by_recording_broker() -> None:
    broker: RealtimeBroker = RecordingBroker()
    broker.publish("taskflow:workspace:x", "{}")
    assert isinstance(broker, RecordingBroker)


def test_queue_workspace_event_routes_to_workspace_and_project_channels(
    db_session: Session,
) -> None:
    recording = RecordingBroker()
    set_broker(recording)
    try:
        workspace_id = uuid.uuid4()
        project_id = uuid.uuid4()
        queue_workspace_event(
            db_session,
            workspace_id=workspace_id,
            event_type="project.updated",
            project_id=project_id,
            task_id=None,
            actor_id=None,
            occurred_at=datetime.now(tz=UTC),
            metadata={},
        )
        db_session.commit()

        channels = {channel for channel, _ in recording.published}
        assert workspace_channel(workspace_id) in channels
        assert project_channel(project_id) in channels
    finally:
        reset_broker()


def test_queue_workspace_event_skips_unknown_activity_types(db_session: Session) -> None:
    recording = RecordingBroker()
    set_broker(recording)
    try:
        queue_workspace_event(
            db_session,
            workspace_id=uuid.uuid4(),
            event_type="workspace.member_added",  # not a realtime-facing type
            project_id=None,
            task_id=None,
            actor_id=None,
            occurred_at=datetime.now(tz=UTC),
            metadata={},
        )
        db_session.commit()

        assert recording.published == []
    finally:
        reset_broker()


def test_user_channel_helper_matches_notification_delivery_channel() -> None:
    some_id = uuid.uuid4()
    assert user_channel(some_id) == f"taskflow:user:{some_id}"


def test_redis_broker_reconnects_after_listener_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_sleep(delay: float) -> None:
        assert delay >= 1

    monkeypatch.setattr("app.realtime.broker.asyncio.sleep", no_sleep)

    class FlakyBroker(RedisBroker):
        def __init__(self) -> None:
            super().__init__("redis://example.invalid/0")
            self.connect_count = 0
            self.listen_count = 0

        async def _connect(self) -> None:
            self.connect_count += 1
            self._pubsub = object()  # type: ignore[assignment]

        async def _close_subscriber(self) -> None:
            return None

        async def _listen(self, pubsub: object) -> None:
            self.listen_count += 1
            if self.listen_count == 1:
                raise RuntimeError("redis connection dropped")
            self._stopping = True

    async def run() -> FlakyBroker:
        broker = FlakyBroker()
        await broker._listen_forever()
        return broker

    broker = asyncio.run(run())

    assert broker.connect_count == 2
    assert broker.listen_count == 2


def test_redis_broker_skips_malformed_pubsub_messages() -> None:
    class RecordingManager:
        def __init__(self) -> None:
            self.dispatched: list[tuple[str, str]] = []

        async def dispatch(self, channel: str, message: str) -> None:
            self.dispatched.append((channel, message))

    class FakePubSub:
        def listen(self) -> AsyncIterator[dict[str, object]]:
            async def messages() -> AsyncIterator[dict[str, object]]:
                yield {"type": "pmessage", "data": "{}"}
                yield {"type": "pmessage", "channel": b"taskflow:workspace:1", "data": b"ok"}

            return messages()

    async def run() -> RecordingManager:
        manager = RecordingManager()
        broker = RedisBroker("redis://example.invalid/0", manager=cast(Any, manager))
        await broker._listen(cast(Any, FakePubSub()))
        return manager

    manager = asyncio.run(run())

    assert manager.dispatched == [("taskflow:workspace:1", "ok")]
