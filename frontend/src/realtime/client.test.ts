import { beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeClient } from "./client";

class CapturingWebSocket {
  static instances: CapturingWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState: number = CapturingWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    CapturingWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    // Mirrors a real WebSocket: once closed, no further message events fire.
    this.readyState = CapturingWebSocket.CLOSED;
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "connected", user_id: "u1" }) });
  }

  emitMessage(payload: unknown) {
    if (this.readyState === CapturingWebSocket.CLOSED) return;
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

beforeEach(() => {
  vi.useRealTimers();
  CapturingWebSocket.instances = [];
  // @ts-expect-error test-only global shim
  globalThis.WebSocket = CapturingWebSocket;
  globalThis.fetch = vi.fn(async () =>
    ({
      ok: true,
      json: async () => ({
        ticket: `ticket-${CapturingWebSocket.instances.length + 1}`,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    }) as Response,
  ) as typeof fetch;
});

async function connectedClient(): Promise<{ client: RealtimeClient; socket: CapturingWebSocket }> {
  const client = new RealtimeClient("test-token");
  client.connect();
  await flushConnectionSetup();
  const socket = CapturingWebSocket.instances[0];
  socket.emitOpen();
  return { client, socket };
}

describe("RealtimeClient", () => {
  it("connects with one-time websocket tickets instead of access tokens", async () => {
    const { socket } = await connectedClient();

    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/auth/ws-ticket", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(socket.url).toBe("ws://localhost:8000/ws?ticket=ticket-1");
    expect(socket.url).not.toContain("test-token");
  });

  it("delivers a realtime event to subscribed listeners", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    socket.emitMessage({
      schema_version: 1,
      event_id: "evt-1",
      event_type: "task.created",
      workspace_id: "w1",
      project_id: "p1",
      task_id: "t1",
      actor_id: null,
      occurred_at: new Date().toISOString(),
      data: {},
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("deduplicates a redelivered event by event_id", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);

    const event = {
      schema_version: 1,
      event_id: "evt-dup",
      event_type: "task.created",
      workspace_id: "w1",
      project_id: "p1",
      task_id: "t1",
      actor_id: null,
      occurred_at: new Date().toISOString(),
      data: {},
    };

    socket.emitMessage(event);
    socket.emitMessage(event);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resends active subscriptions after every connected ack (covers reconnect)", async () => {
    const { client, socket } = await connectedClient();
    client.subscribeWorkspace("workspace-1");
    socket.sent = [];

    // Simulate a reconnect: server sends "connected" again on the same socket.
    socket.emitOpen();

    const subscribeMessages = socket.sent
      .map((raw) => JSON.parse(raw))
      .filter((message) => message.action === "subscribe");
    expect(subscribeMessages).toContainEqual({
      action: "subscribe",
      scope: "workspace",
      workspace_id: "workspace-1",
    });
  });

  it("reports disconnect and restores active subscriptions on reconnect", async () => {
    vi.useFakeTimers();
    const { client, socket } = await connectedClient();
    const statuses: string[] = [];
    client.onStatusChange((status) => statuses.push(status));
    client.subscribeWorkspace("workspace-1");
    client.subscribeProject("workspace-1", "project-1");

    socket.close();

    expect(statuses).toContain("disconnected");
    expect(CapturingWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    await flushConnectionSetup();
    const reconnectSocket = CapturingWebSocket.instances[1];
    reconnectSocket.emitOpen();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reconnectSocket.url).toBe("ws://localhost:8000/ws?ticket=ticket-2");
    expect(statuses).toContain("connected");
    expect(reconnectSocket.sent.map((raw) => JSON.parse(raw))).toEqual(
      expect.arrayContaining([
        {
          action: "subscribe",
          scope: "workspace",
          workspace_id: "workspace-1",
        },
        {
          action: "subscribe",
          scope: "project",
          workspace_id: "workspace-1",
          project_id: "project-1",
        },
      ]),
    );

    client.disconnect();
    vi.useRealTimers();
  });

  it("does not restore a workspace subscription after it is unsubscribed", async () => {
    const { client, socket } = await connectedClient();
    client.subscribeWorkspace("workspace-1");
    client.unsubscribeWorkspace("workspace-1");
    socket.sent = [];

    socket.emitOpen();

    expect(socket.sent.map((raw) => JSON.parse(raw))).not.toContainEqual({
      action: "subscribe",
      scope: "workspace",
      workspace_id: "workspace-1",
    });
  });

  it("keeps duplicate workspace subscriptions active until every subscriber unsubscribes", async () => {
    const { client, socket } = await connectedClient();
    client.subscribeWorkspace("workspace-1");
    client.subscribeWorkspace("workspace-1");

    const firstSubscribeMessages = socket.sent
      .map((raw) => JSON.parse(raw))
      .filter((message) => message.action === "subscribe");
    expect(firstSubscribeMessages).toHaveLength(1);

    client.unsubscribeWorkspace("workspace-1");
    socket.sent = [];
    socket.emitOpen();

    expect(socket.sent.map((raw) => JSON.parse(raw))).toContainEqual({
      action: "subscribe",
      scope: "workspace",
      workspace_id: "workspace-1",
    });

    client.unsubscribeWorkspace("workspace-1");
    socket.sent = [];
    socket.emitOpen();

    expect(socket.sent.map((raw) => JSON.parse(raw))).not.toContainEqual({
      action: "subscribe",
      scope: "workspace",
      workspace_id: "workspace-1",
    });
  });

  it("stops delivering events after disconnect", async () => {
    const { client, socket } = await connectedClient();
    const listener = vi.fn();
    client.onEvent(listener);
    client.disconnect();

    socket.emitMessage({
      schema_version: 1,
      event_id: "evt-after-close",
      event_type: "task.created",
      workspace_id: "w1",
      project_id: null,
      task_id: null,
      actor_id: null,
      occurred_at: new Date().toISOString(),
      data: {},
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

async function flushConnectionSetup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
