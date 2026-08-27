import type { StoredSession } from "../features/auth/sessionStorage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type ProjectStatus = "active" | "archived";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

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

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Project request failed");
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

export async function listProjects(
  session: StoredSession,
  workspaceId: string,
): Promise<Project[]> {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/projects`, {
    headers: headers(session),
  });
  return parseResponse<Project[]>(response);
}

export async function createProject(
  session: StoredSession,
  workspaceId: string,
  input: { name: string; description?: string },
): Promise<Project> {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/projects`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(input),
  });
  return parseResponse<Project>(response);
}

export async function listTasks(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
): Promise<Task[]> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks`,
    { headers: headers(session) },
  );
  return parseResponse<Task[]>(response);
}

export async function createTask(
  session: StoredSession,
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
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks`,
    {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<Task>(response);
}

export async function updateTask(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
  taskId: string,
  input: Partial<Pick<Task, "status" | "priority" | "assignee_id" | "due_at">>,
): Promise<Task> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: headers(session),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<Task>(response);
}

export async function listLabels(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
): Promise<Label[]> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/labels`,
    { headers: headers(session) },
  );
  return parseResponse<Label[]>(response);
}

export async function createLabel(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
  input: { name: string; color: string },
): Promise<Label> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/labels`,
    {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify(input),
    },
  );
  return parseResponse<Label>(response);
}

export async function addTaskLabel(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
  taskId: string,
  labelId: string,
): Promise<Label[]> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/labels`,
    {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ label_id: labelId }),
    },
  );
  return parseResponse<Label[]>(response);
}

export async function listTaskLabels(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<Label[]> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/labels`,
    { headers: headers(session) },
  );
  return parseResponse<Label[]>(response);
}

export async function listComments(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
  taskId: string,
): Promise<Comment[]> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`,
    { headers: headers(session) },
  );
  return parseResponse<Comment[]>(response);
}

export async function createComment(
  session: StoredSession,
  workspaceId: string,
  projectId: string,
  taskId: string,
  body: string,
): Promise<Comment> {
  const response = await fetch(
    `${API_BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`,
    {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ body }),
    },
  );
  return parseResponse<Comment>(response);
}
