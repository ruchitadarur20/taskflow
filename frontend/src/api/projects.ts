import { apiRequest } from "./client";

export type ProjectStatus = "active" | "archived";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export type Project = {
  id: string;
  workspace_id: string;
  created_by_id: string;
  name: string;
  description: string | null;
  slug: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Task = {
  id: string;
  workspace_id: string;
  project_id: string;
  parent_task_id: string | null;
  created_by_id: string;
  assignee_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Label = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

export type TaskDependency = {
  blocking_task_id: string;
  blocked_task_id: string;
  created_at: string;
};

export type Comment = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ActivityEvent = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  event_type: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

// --- Projects ---------------------------------------------------------------

export function listProjects(token: string, workspaceId: string): Promise<Project[]> {
  return apiRequest<Project[]>(`/workspaces/${workspaceId}/projects`, { token });
}

export function createProject(
  token: string,
  workspaceId: string,
  input: { name: string; description?: string },
): Promise<Project> {
  return apiRequest<Project>(`/workspaces/${workspaceId}/projects`, {
    method: "POST",
    token,
    body: input,
  });
}

export function getProject(
  token: string,
  workspaceId: string,
  projectId: string,
): Promise<Project> {
  return apiRequest<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, { token });
}

export function updateProject(
  token: string,
  workspaceId: string,
  projectId: string,
  input: { name?: string; description?: string },
): Promise<Project> {
  return apiRequest<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function archiveProject(
  token: string,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  return apiRequest<void>(`/workspaces/${workspaceId}/projects/${projectId}`, {
    method: "DELETE",
    token,
  });
}

// --- Labels -------------------------------------------------------------------

export function listLabels(
  token: string,
  workspaceId: string,
  projectId: string,
): Promise<Label[]> {
  return apiRequest<Label[]>(`/workspaces/${workspaceId}/projects/${projectId}/labels`, { token });
}

export function createLabel(
  token: string,
  workspaceId: string,
  projectId: string,
  input: { name: string; color: string },
): Promise<Label> {
  return apiRequest<Label>(`/workspaces/${workspaceId}/projects/${projectId}/labels`, {
    method: "POST",
    token,
    body: input,
  });
}

// --- Tasks ----------------------------------------------------------------

export type TaskFilters = {
  status?: TaskStatus;
  assignee_id?: string;
  limit?: number;
  offset?: number;
};

export function listTasks(
  token: string,
  workspaceId: string,
  projectId: string,
  filters: TaskFilters = {},
): Promise<Task[]> {
  return apiRequest<Task[]>(`/workspaces/${workspaceId}/projects/${projectId}/tasks`, {
    token,
    query: filters,
  });
}

export function getTask(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<Task> {
  return apiRequest<Task>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`, {
    token,
  });
}

export function createTask(
  token: string,
  workspaceId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assignee_id?: string | null;
    due_at?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    parent_task_id?: string | null;
  },
): Promise<Task> {
  return apiRequest<Task>(`/workspaces/${workspaceId}/projects/${projectId}/tasks`, {
    method: "POST",
    token,
    body: input,
  });
}

export type TaskUpdateInput = Partial<
  Pick<
    Task,
    "title" | "description" | "status" | "priority" | "assignee_id" | "due_at" | "parent_task_id"
  >
>;

export function updateTask(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  input: TaskUpdateInput,
): Promise<Task> {
  return apiRequest<Task>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function archiveTask(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<void> {
  return apiRequest<void>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`, {
    method: "DELETE",
    token,
  });
}

// --- Task labels ----------------------------------------------------------

export function listTaskLabels(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<Label[]> {
  return apiRequest<Label[]>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/labels`,
    { token },
  );
}

export function addTaskLabel(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  labelId: string,
): Promise<Label[]> {
  return apiRequest<Label[]>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/labels`,
    { method: "POST", token, body: { label_id: labelId } },
  );
}

export function removeTaskLabel(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  labelId: string,
): Promise<void> {
  return apiRequest<void>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/labels/${labelId}`,
    { method: "DELETE", token },
  );
}

// --- Dependencies -----------------------------------------------------------

export function listDependencies(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<TaskDependency[]> {
  return apiRequest<TaskDependency[]>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/dependencies`,
    { token },
  );
}

export function addDependency(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  blockingTaskId: string,
): Promise<TaskDependency> {
  return apiRequest<TaskDependency>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/dependencies`,
    { method: "POST", token, body: { blocking_task_id: blockingTaskId } },
  );
}

// --- Comments ---------------------------------------------------------------

export function listComments(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<Comment[]> {
  return apiRequest<Comment[]>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`,
    { token },
  );
}

export function createComment(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  body: string,
): Promise<Comment> {
  return apiRequest<Comment>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`,
    { method: "POST", token, body: { body } },
  );
}

export function updateComment(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  body: string,
): Promise<Comment> {
  return apiRequest<Comment>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
    { method: "PATCH", token, body: { body } },
  );
}

export function deleteComment(
  token: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
  commentId: string,
): Promise<void> {
  return apiRequest<void>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
    { method: "DELETE", token },
  );
}

// --- Activity ---------------------------------------------------------------

export function listActivity(
  token: string,
  workspaceId: string,
  projectId: string,
  options: { taskId?: string; limit?: number } = {},
): Promise<ActivityEvent[]> {
  return apiRequest<ActivityEvent[]>(`/workspaces/${workspaceId}/projects/${projectId}/activity`, {
    token,
    query: { task_id: options.taskId, limit: options.limit },
  });
}
