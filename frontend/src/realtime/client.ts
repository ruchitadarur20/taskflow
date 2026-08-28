const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");

const MAX_RECONNECT_DELAY_MS = 15_000;
const MAX_SEEN_EVENT_IDS = 500;

export type RealtimeEventType =
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.assignee_changed"
  | "task.due_date_changed"
  | "task.archived"
  | "task.dependency_added"
  | "task.label_added"
  | "task.label_removed"
  | "comment.created"
  | "notification.created"
  | "notification.read";

export type RealtimeEvent = {
  schema_version: number;
  event_id: string;
  event_type: RealtimeEventType;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  occurred_at: string;
  data: Record<string, unknown>;
};

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type EventListener = (event: RealtimeEvent) => void;
type StatusListener = (status: ConnectionStatus) => void;
type SubscribeMessage = {
  action: "subscribe" | "unsubscribe";
  scope: "workspace" | "project";
  workspace_id: string;
  project_id?: string;
};
type ActiveSubscription = {
  message: SubscribeMessage;
  subscribers: number;
};
type WebSocketTicketResponse = {
  ticket: string;
  expires_at: string;
};

/**
 * Authenticated realtime client: one WebSocket per session, reconnecting with
 * exponential backoff, replaying active subscriptions after every (re)connect,
 * and deduplicating events by `event_id` so a redelivered event after a
 * reconnect is never handled twice.
 */
export class RealtimeClient {
  private token: string;
  private socket: WebSocket | null = null;
  private closedByCaller = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: ConnectionStatus = "connecting";
  private activeSubscriptions = new Map<string, ActiveSubscription>();
  private eventListeners = new Set<EventListener>();
  private statusListeners = new Set<StatusListener>();
  private seenEventIds: string[] = [];
  private seenEventIdSet = new Set<string>();

  constructor(token: string) {
    this.token = token;
  }

  connect(): void {
    this.closedByCaller = false;
    this.open();
  }

  disconnect(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  subscribeWorkspace(workspaceId: string): void {
    this.subscribe({ action: "subscribe", scope: "workspace", workspace_id: workspaceId });
  }

  unsubscribeWorkspace(workspaceId: string): void {
    this.unsubscribe({
      action: "unsubscribe",
      scope: "workspace",
      workspace_id: workspaceId,
    });
  }

  subscribeProject(workspaceId: string, projectId: string): void {
    this.subscribe({
      action: "subscribe",
      scope: "project",
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  unsubscribeProject(workspaceId: string, projectId: string): void {
    this.unsubscribe({
      action: "unsubscribe",
      scope: "project",
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private subscribe(message: SubscribeMessage): void {
    const key = subscriptionKey(message.scope, message.workspace_id, message.project_id);
    const current = this.activeSubscriptions.get(key);
    if (current) {
      current.subscribers += 1;
      return;
    }
    this.activeSubscriptions.set(key, { message, subscribers: 1 });
    this.send(message);
  }

  private unsubscribe(message: SubscribeMessage): void {
    const key = subscriptionKey(message.scope, message.workspace_id, message.project_id);
    const current = this.activeSubscriptions.get(key);
    if (!current) {
      return;
    }
    if (current.subscribers > 1) {
      current.subscribers -= 1;
      return;
    }
    this.activeSubscriptions.delete(key);
    this.send(message);
  }

  private open(): void {
    this.setStatus("connecting");
    void this.openWithTicket();
  }

  private async openWithTicket(): Promise<void> {
    let ticket: string;
    try {
      ticket = await requestWebSocketTicket(this.token);
    } catch {
      if (this.closedByCaller) {
        return;
      }
      this.setStatus("disconnected");
      if (!this.closedByCaller) {
        this.scheduleReconnect();
      }
      return;
    }
    if (this.closedByCaller) {
      return;
    }

    const socket = new WebSocket(`${WS_BASE_URL}/ws?ticket=${encodeURIComponent(ticket)}`);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
    };
    socket.onmessage = (event) => {
      this.handleMessage(String(event.data));
    };
    socket.onclose = () => {
      this.socket = null;
      this.setStatus("disconnected");
      if (!this.closedByCaller) {
        this.scheduleReconnect();
      }
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) {
      return;
    }
    const type = (message as { type?: string }).type;

    if (type === "connected") {
      this.setStatus("connected");
      // Resubscribe every active channel after every (re)connect - covers both
      // the first connection and every reconnect after a dropped socket.
      for (const subscription of this.activeSubscriptions.values()) {
        this.send(subscription.message);
      }
      return;
    }
    if (type === "subscribed" || type === "unsubscribed" || type === "error") {
      return;
    }

    const event = message as RealtimeEvent;
    if (!event.event_id || this.seenEventIdSet.has(event.event_id)) {
      return;
    }
    this.rememberEventId(event.event_id);
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private rememberEventId(id: string): void {
    this.seenEventIdSet.add(id);
    this.seenEventIds.push(id);
    if (this.seenEventIds.length > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenEventIds.shift();
      if (oldest !== undefined) {
        this.seenEventIdSet.delete(oldest);
      }
    }
  }

  private send(message: SubscribeMessage): void {
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
    // If the socket isn't open yet, the subscription stays in
    // `activeSubscriptions` and is sent as soon as the next "connected" ack
    // arrives (see handleMessage), so callers never need to retry themselves.
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}

function subscriptionKey(scope: string, workspaceId: string, projectId?: string): string {
  return projectId ? `${scope}:${workspaceId}:${projectId}` : `${scope}:${workspaceId}`;
}

async function requestWebSocketTicket(token: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/ws-ticket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error("Unable to create realtime ticket");
  }
  const body = (await response.json()) as WebSocketTicketResponse;
  return body.ticket;
}
