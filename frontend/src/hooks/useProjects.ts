import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import * as projectsApi from "../api/projects";

export function useProjects(workspaceId: string | undefined) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: async () => projectsApi.listProjects(await getAccessToken(), workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useProject(workspaceId: string | undefined, projectId: string | undefined) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["project", workspaceId, projectId],
    queryFn: async () =>
      projectsApi.getProject(await getAccessToken(), workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function useCreateProject(workspaceId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) =>
      projectsApi.createProject(await getAccessToken(), workspaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
    },
  });
}

export function useUpdateProject(workspaceId: string, projectId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name?: string; description?: string }) =>
      projectsApi.updateProject(await getAccessToken(), workspaceId, projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
    },
  });
}

export function useLabels(workspaceId: string | undefined, projectId: string | undefined) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["labels", workspaceId, projectId],
    queryFn: async () =>
      projectsApi.listLabels(await getAccessToken(), workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function useCreateLabel(workspaceId: string, projectId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color: string }) =>
      projectsApi.createLabel(await getAccessToken(), workspaceId, projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["labels", workspaceId, projectId] });
    },
  });
}
