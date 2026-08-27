import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import * as projectsApi from "../api/projects";
import type { Task, TaskFilters, TaskUpdateInput } from "../api/projects";

function tasksKey(workspaceId: string, projectId: string, filters: TaskFilters = {}) {
  return ["tasks", workspaceId, projectId, filters] as const;
}

export function useTasks(
  workspaceId: string | undefined,
  projectId: string | undefined,
  filters: TaskFilters = {},
) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["tasks", workspaceId, projectId, filters],
    queryFn: async () =>
      projectsApi.listTasks(
        await getAccessToken(),
        workspaceId as string,
        projectId as string,
        filters,
      ),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function useTask(
  workspaceId: string | undefined,
  projectId: string | undefined,
  taskId: string | undefined,
) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["task", workspaceId, projectId, taskId],
    queryFn: async () =>
      projectsApi.getTask(
        await getAccessToken(),
        workspaceId as string,
        projectId as string,
        taskId as string,
      ),
    enabled: Boolean(workspaceId && projectId && taskId),
  });
}

export function useCreateTask(workspaceId: string, projectId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof projectsApi.createTask>[3]) =>
      projectsApi.createTask(await getAccessToken(), workspaceId, projectId, input),
    onSuccess: (task) => {
      queryClient.setQueriesData<Task[]>(
        { queryKey: ["tasks", workspaceId, projectId] },
        (current) => (current ? [...current, task] : current),
      );
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

/**
 * Updates a task with an optimistic patch to both the list and detail caches
 * - the drag-and-drop board and inline selectors need the UI to move
 * immediately, not after a round trip. Rolls back on failure and always
 * reconciles with the server afterward.
 */
export function useUpdateTask(workspaceId: string, projectId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, input }: { taskId: string; input: TaskUpdateInput }) =>
      projectsApi.updateTask(await getAccessToken(), workspaceId, projectId, taskId, input),
    onMutate: async ({ taskId, input }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks", workspaceId, projectId] });
      await queryClient.cancelQueries({ queryKey: ["task", workspaceId, projectId, taskId] });

      const previousLists = queryClient.getQueriesData<Task[]>({
        queryKey: ["tasks", workspaceId, projectId],
      });
      const previousTask = queryClient.getQueryData<Task>([
        "task",
        workspaceId,
        projectId,
        taskId,
      ]);

      previousLists.forEach(([key, tasks]) => {
        if (!tasks) return;
        queryClient.setQueryData<Task[]>(
          key,
          tasks.map((task) => (task.id === taskId ? { ...task, ...input } : task)),
        );
      });
      if (previousTask) {
        queryClient.setQueryData(["task", workspaceId, projectId, taskId], {
          ...previousTask,
          ...input,
        });
      }

      return { previousLists, previousTask, taskId };
    },
    onError: (_error, _variables, context) => {
      context?.previousLists.forEach(([key, tasks]) => {
        queryClient.setQueryData(key, tasks);
      });
      if (context?.previousTask) {
        queryClient.setQueryData(
          ["task", workspaceId, projectId, context.taskId],
          context.previousTask,
        );
      }
    },
    onSettled: (_data, _error, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["task", workspaceId, projectId, taskId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useArchiveTask(workspaceId: string, projectId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) =>
      projectsApi.archiveTask(await getAccessToken(), workspaceId, projectId, taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useTaskLabels(
  workspaceId: string | undefined,
  projectId: string | undefined,
  taskId: string | undefined,
) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["task-labels", workspaceId, projectId, taskId],
    queryFn: async () =>
      projectsApi.listTaskLabels(
        await getAccessToken(),
        workspaceId as string,
        projectId as string,
        taskId as string,
      ),
    enabled: Boolean(workspaceId && projectId && taskId),
  });
}

export function useAddTaskLabel(workspaceId: string, projectId: string, taskId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (labelId: string) =>
      projectsApi.addTaskLabel(await getAccessToken(), workspaceId, projectId, taskId, labelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["task-labels", workspaceId, projectId, taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useRemoveTaskLabel(workspaceId: string, projectId: string, taskId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (labelId: string) =>
      projectsApi.removeTaskLabel(await getAccessToken(), workspaceId, projectId, taskId, labelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["task-labels", workspaceId, projectId, taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useDependencies(
  workspaceId: string | undefined,
  projectId: string | undefined,
  taskId: string | undefined,
) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["task-dependencies", workspaceId, projectId, taskId],
    queryFn: async () =>
      projectsApi.listDependencies(
        await getAccessToken(),
        workspaceId as string,
        projectId as string,
        taskId as string,
      ),
    enabled: Boolean(workspaceId && projectId && taskId),
  });
}

export function useAddDependency(workspaceId: string, projectId: string, taskId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blockingTaskId: string) =>
      projectsApi.addDependency(
        await getAccessToken(),
        workspaceId,
        projectId,
        taskId,
        blockingTaskId,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["task-dependencies", workspaceId, projectId, taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useComments(
  workspaceId: string | undefined,
  projectId: string | undefined,
  taskId: string | undefined,
) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["task-comments", workspaceId, projectId, taskId],
    queryFn: async () =>
      projectsApi.listComments(
        await getAccessToken(),
        workspaceId as string,
        projectId as string,
        taskId as string,
      ),
    enabled: Boolean(workspaceId && projectId && taskId),
  });
}

export function useCreateComment(workspaceId: string, projectId: string, taskId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) =>
      projectsApi.createComment(await getAccessToken(), workspaceId, projectId, taskId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["task-comments", workspaceId, projectId, taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useUpdateComment(workspaceId: string, projectId: string, taskId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ commentId, body }: { commentId: string; body: string }) =>
      projectsApi.updateComment(
        await getAccessToken(),
        workspaceId,
        projectId,
        taskId,
        commentId,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["task-comments", workspaceId, projectId, taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useDeleteComment(workspaceId: string, projectId: string, taskId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) =>
      projectsApi.deleteComment(
        await getAccessToken(),
        workspaceId,
        projectId,
        taskId,
        commentId,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["task-comments", workspaceId, projectId, taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    },
  });
}

export function useActivity(
  workspaceId: string | undefined,
  projectId: string | undefined,
  taskId?: string,
) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["activity", workspaceId, projectId, taskId],
    queryFn: async () =>
      projectsApi.listActivity(await getAccessToken(), workspaceId as string, projectId as string, {
        taskId,
      }),
    enabled: Boolean(workspaceId && projectId),
  });
}

export { tasksKey };
