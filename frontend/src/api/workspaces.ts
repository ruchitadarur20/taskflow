import type { StoredSession } from "../features/auth/sessionStorage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type Workspace = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  current_user_role: WorkspaceRole;
};

export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
  updated_at: string;
  user: {
    id: string;
    email: string;
    display_name: string;
    created_at: string;
  };
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Workspace request failed");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function headers(session: StoredSession): HeadersInit {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function listWorkspaces(session: StoredSession): Promise<Workspace[]> {
  const response = await fetch(`${API_BASE_URL}/workspaces`, { headers: headers(session) });
  return parseResponse<Workspace[]>(response);
}

export async function createWorkspace(
  session: StoredSession,
  name: string,
): Promise<Workspace> {
  const response = await fetch(`${API_BASE_URL}/workspaces`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name }),
  });
  return parseResponse<Workspace>(response);
}

export async function getWorkspaceMembers(
  session: StoredSession,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/members`, {
    headers: headers(session),
  });
  return parseResponse<WorkspaceMember[]>(response);
}
