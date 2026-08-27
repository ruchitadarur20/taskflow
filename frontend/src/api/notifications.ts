import type { StoredSession } from "../features/auth/sessionStorage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type Notification = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  type: string;
  title: string;
  body: string | null;
  payload_json: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Notification request failed");
  }
  return (await response.json()) as T;
}

function headers(session: StoredSession): HeadersInit {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function listNotifications(
  session: StoredSession,
  options: { workspaceId?: string; unreadOnly?: boolean } = {},
): Promise<Notification[]> {
  const params = new URLSearchParams();
  if (options.workspaceId) {
    params.set("workspace_id", options.workspaceId);
  }
  if (options.unreadOnly) {
    params.set("unread_only", "true");
  }
  const query = params.toString();
  const response = await fetch(`${API_BASE_URL}/notifications${query ? `?${query}` : ""}`, {
    headers: headers(session),
  });
  return parseResponse<Notification[]>(response);
}

export async function getUnreadCount(
  session: StoredSession,
  workspaceId?: string,
): Promise<number> {
  const query = workspaceId ? `?workspace_id=${workspaceId}` : "";
  const response = await fetch(`${API_BASE_URL}/notifications/unread-count${query}`, {
    headers: headers(session),
  });
  const body = await parseResponse<{ unread_count: number }>(response);
  return body.unread_count;
}

export async function markNotificationRead(
  session: StoredSession,
  notificationId: string,
): Promise<Notification> {
  const response = await fetch(`${API_BASE_URL}/notifications/${notificationId}/read`, {
    method: "POST",
    headers: headers(session),
  });
  return parseResponse<Notification>(response);
}
