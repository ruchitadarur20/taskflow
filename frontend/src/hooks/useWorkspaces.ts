import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import * as workspacesApi from "../api/workspaces";
import type { WorkspaceRole } from "../api/workspaces";

export function useWorkspaces() {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => workspacesApi.listWorkspaces(await getAccessToken()),
  });
}

export function useWorkspace(workspaceId: string | undefined) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: async () => workspacesApi.getWorkspace(await getAccessToken(), workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => workspacesApi.listMembers(await getAccessToken(), workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateWorkspace() {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      workspacesApi.createWorkspace(await getAccessToken(), name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

/** Maps user id -> workspace member, for rendering assignee/actor names from
 * an id without every component re-fetching the member list itself. */
export function useMemberLookup(workspaceId: string | undefined) {
  const membersQuery = useWorkspaceMembers(workspaceId);
  const byUserId = new Map((membersQuery.data ?? []).map((member) => [member.user_id, member]));
  return { byUserId, isLoading: membersQuery.isLoading };
}

export function useAddWorkspaceMember(workspaceId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: WorkspaceRole }) =>
      workspacesApi.addMember(await getAccessToken(), workspaceId, email, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    },
  });
}

export function useChangeMemberRole(workspaceId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      workspacesApi.changeMemberRole(await getAccessToken(), workspaceId, userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    },
  });
}

export function useRemoveMember(workspaceId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      workspacesApi.removeMember(await getAccessToken(), workspaceId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    },
  });
}
