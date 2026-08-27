import { apiRequest } from "./client";

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

export function listNotifications(
  token: string,
  options: { workspaceId?: string; unreadOnly?: boolean } = {},
): Promise<Notification[]> {
  return apiRequest<Notification[]>("/notifications", {
    token,
    query: { workspace_id: options.workspaceId, unread_only: options.unreadOnly },
  });
}

export async function getUnreadCount(token: string, workspaceId?: string): Promise<number> {
  const body = await apiRequest<{ unread_count: number }>("/notifications/unread-count", {
    token,
    query: { workspace_id: workspaceId },
  });
  return body.unread_count;
}

export function markNotificationRead(token: string, notificationId: string): Promise<Notification> {
  return apiRequest<Notification>(`/notifications/${notificationId}/read`, {
    method: "POST",
    token,
  });
}
