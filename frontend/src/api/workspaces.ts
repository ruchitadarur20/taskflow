import { apiRequest } from "./client";
import type { AuthUser } from "./auth";

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
  user: AuthUser;
};

export function listWorkspaces(token: string): Promise<Workspace[]> {
  return apiRequest<Workspace[]>("/workspaces", { token });
}

export function createWorkspace(token: string, name: string): Promise<Workspace> {
  return apiRequest<Workspace>("/workspaces", { method: "POST", token, body: { name } });
}

export function getWorkspace(token: string, workspaceId: string): Promise<Workspace> {
  return apiRequest<Workspace>(`/workspaces/${workspaceId}`, { token });
}

export function updateWorkspace(
  token: string,
  workspaceId: string,
  name: string,
): Promise<Workspace> {
  return apiRequest<Workspace>(`/workspaces/${workspaceId}`, {
    method: "PATCH",
    token,
    body: { name },
  });
}

export function archiveWorkspace(token: string, workspaceId: string): Promise<void> {
  return apiRequest<void>(`/workspaces/${workspaceId}`, { method: "DELETE", token });
}

export function listMembers(token: string, workspaceId: string): Promise<WorkspaceMember[]> {
  return apiRequest<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`, { token });
}

export function addMember(
  token: string,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  return apiRequest<WorkspaceMember>(`/workspaces/${workspaceId}/members`, {
    method: "POST",
    token,
    body: { email, role },
  });
}

export function changeMemberRole(
  token: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  return apiRequest<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, {
    method: "PATCH",
    token,
    body: { role },
  });
}

export function removeMember(token: string, workspaceId: string, userId: string): Promise<void> {
  return apiRequest<void>(`/workspaces/${workspaceId}/members/${userId}`, {
    method: "DELETE",
    token,
  });
}
