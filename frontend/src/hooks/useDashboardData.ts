import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { useProjects } from "./useProjects";
import * as projectsApi from "../api/projects";
import type { Task } from "../api/projects";

/**
 * The dashboard needs "my tasks across the whole workspace" and "recent
 * activity across the whole workspace", but the backend only exposes tasks
 * and activity scoped to one project at a time (no workspace-wide endpoint
 * for either). This aggregates by calling those per-project endpoints once
 * per project and merging - see docs/frontend.md "API Gaps" for the
 * dedicated endpoints that would replace this.
 */
export function useMyTasksAcrossWorkspace(workspaceId: string | undefined, userId: string | undefined) {
  const { getAccessToken } = useAuth();
  const projectsQuery = useProjects(workspaceId);
  const projectIds = (projectsQuery.data ?? []).map((project) => project.id);

  const tasksQuery = useQuery({
    queryKey: ["dashboard-my-tasks", workspaceId, userId, projectIds],
    queryFn: async () => {
      const token = await getAccessToken();
      const lists = await Promise.all(
        projectIds.map((projectId) =>
          projectsApi.listTasks(token, workspaceId as string, projectId, {
            assignee_id: userId,
            limit: 100,
          }),
        ),
      );
      return lists.flat();
    },
    enabled: Boolean(workspaceId && userId) && projectIds.length > 0,
  });

  return { tasks: tasksQuery.data ?? [], isLoading: projectsQuery.isLoading || tasksQuery.isLoading };
}

export function useRecentActivityAcrossWorkspace(workspaceId: string | undefined) {
  const { getAccessToken } = useAuth();
  const projectsQuery = useProjects(workspaceId);
  const projectIds = (projectsQuery.data ?? []).map((project) => project.id);

  const activityQuery = useQuery({
    queryKey: ["dashboard-activity", workspaceId, projectIds],
    queryFn: async () => {
      const token = await getAccessToken();
      const lists = await Promise.all(
        projectIds.map((projectId) =>
          projectsApi.listActivity(token, workspaceId as string, projectId, { limit: 10 }),
        ),
      );
      return lists
        .flat()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 12);
    },
    enabled: Boolean(workspaceId) && projectIds.length > 0,
  });

  return { activity: activityQuery.data ?? [], isLoading: projectsQuery.isLoading || activityQuery.isLoading };
}

export type TaskBuckets = {
  overdue: Task[];
  dueSoon: Task[];
  upcoming: Task[];
};

export function bucketTasksByDueDate(tasks: Task[]): TaskBuckets {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const active = tasks.filter((task) => task.status !== "done" && task.status !== "archived");

  const overdue: Task[] = [];
  const dueSoon: Task[] = [];
  const upcoming: Task[] = [];

  for (const task of active) {
    if (!task.due_at) {
      upcoming.push(task);
      continue;
    }
    const dueAt = new Date(task.due_at).getTime();
    if (dueAt < now) {
      overdue.push(task);
    } else if (dueAt - now <= sevenDaysMs) {
      dueSoon.push(task);
    } else {
      upcoming.push(task);
    }
  }

  const byDueDate = (a: Task, b: Task) => {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  };

  return {
    overdue: overdue.sort(byDueDate),
    dueSoon: dueSoon.sort(byDueDate),
    upcoming: upcoming.sort(byDueDate),
  };
}
