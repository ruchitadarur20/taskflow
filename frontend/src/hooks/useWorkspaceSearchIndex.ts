import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { useProjects } from "./useProjects";
import * as projectsApi from "../api/projects";
import type { Task } from "../api/projects";

/**
 * Client-side search index for a workspace: its projects (already cached by
 * the sidebar/dashboard) plus every project's tasks, fetched in parallel.
 *
 * There is no backend search endpoint (no `GET /workspaces/{id}/search`) so
 * this is the identified API gap - see docs/frontend.md. This aggregation
 * scales to a workspace with a modest number of projects/tasks; a real
 * full-text search endpoint would be needed beyond that.
 */
export function useWorkspaceSearchIndex(workspaceId: string | undefined, enabled: boolean) {
  const { getAccessToken } = useAuth();
  const projectsQuery = useProjects(workspaceId);
  const projectIds = (projectsQuery.data ?? []).map((project) => project.id);

  const tasksQuery = useQuery({
    queryKey: ["search-tasks", workspaceId, projectIds],
    queryFn: async () => {
      const token = await getAccessToken();
      const lists = await Promise.allSettled(
        projectIds.map((projectId) =>
          projectsApi.listTasks(token, workspaceId as string, projectId, { limit: 100 }),
        ),
      );
      const fulfilled = lists
        .filter((result): result is PromiseFulfilledResult<Task[]> => result.status === "fulfilled")
        .flatMap((result) => result.value);
      const rejected = lists.filter((result) => result.status === "rejected");
      if (rejected.length === lists.length) {
        throw rejected[0].reason;
      }
      return fulfilled;
    },
    enabled: enabled && Boolean(workspaceId) && projectIds.length > 0,
  });

  return {
    projects: projectsQuery.data ?? [],
    tasks: tasksQuery.data ?? [],
    isLoading: projectsQuery.isLoading || tasksQuery.isLoading,
    isError: projectsQuery.isError || tasksQuery.isError,
    error: projectsQuery.error ?? tasksQuery.error,
  };
}
