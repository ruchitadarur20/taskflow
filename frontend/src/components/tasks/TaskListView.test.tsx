import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import { AppLayout } from "../layout/AppLayout";
import { RequireAuth } from "../auth/RequireAuth";
import { TaskListView } from "./TaskListView";
import { ProjectPage } from "../../pages/ProjectPage";
import { TEST_TOKENS, mockApi, renderWithProviders, seedLoggedInSession } from "../../test/utils";
import type { Task, TaskPriority, TaskStatus } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

const NOW = "2026-09-01T14:00:00.000Z";
const OWNER_WORKSPACE = {
  id: "w1",
  owner_id: TEST_TOKENS.user.id,
  name: "Design Team",
  slug: "design-team",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
  archived_at: null,
  current_user_role: "owner",
};
const VIEWER_WORKSPACE = { ...OWNER_WORKSPACE, current_user_role: "viewer" };
const PROJECT = {
  id: "p1",
  workspace_id: "w1",
  created_by_id: TEST_TOKENS.user.id,
  name: "Launch Plan",
  description: "Core launch work",
  slug: "launch-plan",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
  archived_at: null,
};
const MEMBER: WorkspaceMember = {
  id: "m1",
  workspace_id: "w1",
  user_id: TEST_TOKENS.user.id,
  role: "owner",
  created_at: NOW,
  updated_at: NOW,
  user: TEST_TOKENS.user,
};
const ASSIGNEE: WorkspaceMember = {
  id: "m2",
  workspace_id: "w1",
  user_id: "22222222-2222-2222-2222-222222222222",
  role: "member",
  created_at: NOW,
  updated_at: NOW,
  user: {
    id: "22222222-2222-2222-2222-222222222222",
    email: "member@example.com",
    display_name: "Member Person",
    created_at: NOW,
  },
};

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    workspace_id: "w1",
    project_id: "p1",
    parent_task_id: null,
    created_by_id: "u1",
    assignee_id: null,
    title: "Untitled",
    description: null,
    status: "todo",
    priority: "medium",
    due_at: null,
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    ...overrides,
  };
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  return init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
}

function ProjectRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<p>Login page</p>} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/w/:workspaceId/projects/:projectId" element={<ProjectPage />} />
      </Route>
    </Routes>
  );
}

function installTaskApi({
  workspace = OWNER_WORKSPACE,
  tasks = [task({ id: "t1", title: "Write docs" })],
  taskDetails,
  overrides = {},
}: {
  workspace?: typeof OWNER_WORKSPACE;
  tasks?: Task[];
  taskDetails?: Record<string, Task>;
  overrides?: Record<string, (url: URL, init?: RequestInit) => unknown | Promise<unknown>>;
} = {}) {
  const taskState = [...tasks];
  const detailState = new Map(Object.entries(taskDetails ?? Object.fromEntries(tasks.map((item) => [item.id, item]))));

  const createTask = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const created = task({
      id: "t-created",
      title: String(body.title),
      priority: body.priority as TaskPriority,
      assignee_id: body.assignee_id as string | null,
      due_at: body.due_at as string | null,
    });
    taskState.push(created);
    detailState.set(created.id, created);
    return created;
  });

  const updateTask = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const current = detailState.get("t1") ?? taskState[0];
    const updated = { ...current, ...body, updated_at: "2026-09-02T14:00:00.000Z" } as Task;
    detailState.set("t1", updated);
    const index = taskState.findIndex((item) => item.id === "t1");
    if (index >= 0) taskState[index] = updated;
    return updated;
  });

  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces": () => [workspace],
    "GET /workspaces/w1": () => workspace,
    "GET /workspaces/w1/projects": () => [PROJECT],
    "GET /workspaces/w1/projects/p1": () => PROJECT,
    "GET /workspaces/w1/projects/p1/tasks": () => taskState,
    "GET /workspaces/w1/projects/p1/tasks/t1": () => detailState.get("t1"),
    "GET /workspaces/w1/projects/p1/tasks/t-created": () => detailState.get("t-created"),
    "GET /workspaces/w1/projects/p1/labels": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t1/labels": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t-created/labels": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t1/dependencies": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t-created/dependencies": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t1/comments": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t-created/comments": () => [],
    "GET /workspaces/w1/projects/p1/activity": () => [],
    "GET /workspaces/w1/members": () => [MEMBER, ASSIGNEE],
    "GET /notifications": () => [],
    "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    "POST /workspaces/w1/projects/p1/tasks": createTask,
    "PATCH /workspaces/w1/projects/p1/tasks/t1": updateTask,
    ...overrides,
  });

  return { createTask, updateTask, taskState };
}

describe("TaskListView", () => {
  it("renders every task by default", () => {
    const tasks = [task({ id: "t1", title: "Write docs" }), task({ id: "t2", title: "Ship release" })];
    render(<TaskListView tasks={tasks} byUserId={new Map()} onOpenTask={vi.fn()} />);

    expect(screen.getByText("Write docs")).toBeInTheDocument();
    expect(screen.getByText("Ship release")).toBeInTheDocument();
  });

  it("filters tasks by title", async () => {
    const tasks = [task({ id: "t1", title: "Write docs" }), task({ id: "t2", title: "Ship release" })];
    render(<TaskListView tasks={tasks} byUserId={new Map()} onOpenTask={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText("Filter by title..."), "ship");

    expect(screen.queryByText("Write docs")).not.toBeInTheDocument();
    expect(screen.getByText("Ship release")).toBeInTheDocument();
  });

  it("filters tasks by status", async () => {
    const tasks = [
      task({ id: "t1", title: "Write docs", status: "todo" }),
      task({ id: "t2", title: "Ship release", status: "done" }),
    ];
    render(<TaskListView tasks={tasks} byUserId={new Map()} onOpenTask={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "done");

    expect(screen.queryByText("Write docs")).not.toBeInTheDocument();
    expect(screen.getByText("Ship release")).toBeInTheDocument();
  });

  it("calls onOpenTask when a row is clicked", async () => {
    const onOpenTask = vi.fn();
    const tasks = [task({ id: "t1", title: "Write docs" })];
    render(<TaskListView tasks={tasks} byUserId={new Map()} onOpenTask={onOpenTask} />);

    await userEvent.click(screen.getByText("Write docs"));

    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  it("shows an empty state when there are no tasks", () => {
    render(<TaskListView tasks={[]} byUserId={new Map()} onOpenTask={vi.fn()} />);

    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.getByText("Create the first task for this project.")).toBeInTheDocument();
  });

  it("shows an empty state when no task matches the filters", async () => {
    const tasks = [task({ id: "t1", title: "Write docs" })];
    render(<TaskListView tasks={tasks} byUserId={new Map()} onOpenTask={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText("Filter by title..."), "nonexistent");

    expect(screen.getByText("No matching tasks")).toBeInTheDocument();
  });

  it("renders priority, assignee, and due date metadata", () => {
    const tasks = [
      task({
        id: "t1",
        title: "Prepare launch",
        priority: "urgent",
        assignee_id: ASSIGNEE.user_id,
        due_at: "2026-09-03T15:30:00.000Z",
      }),
    ];

    render(<TaskListView tasks={tasks} byUserId={new Map([[ASSIGNEE.user_id, ASSIGNEE]])} onOpenTask={vi.fn()} />);

    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getAllByText("Member Person").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Sep 3/)).toBeInTheDocument();
  });

  it("filters tasks by assignee", async () => {
    const tasks = [
      task({ id: "t1", title: "Assigned task", assignee_id: ASSIGNEE.user_id }),
      task({ id: "t2", title: "Unassigned task", assignee_id: null }),
    ];
    render(<TaskListView tasks={tasks} byUserId={new Map([[ASSIGNEE.user_id, ASSIGNEE]])} onOpenTask={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText("Filter by assignee"), ASSIGNEE.user_id);

    expect(screen.getByText("Assigned task")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned task")).not.toBeInTheDocument();
  });
});

describe("Project task workflow", () => {
  it("shows task loading and API errors", async () => {
    seedLoggedInSession();
    installTaskApi({
      overrides: {
        "GET /workspaces/w1/projects/p1/tasks": () =>
          new Response(JSON.stringify({ detail: "Task list failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByText("Task list failed")).toBeInTheDocument();
  });

  it("creates a task and opens the new task detail", async () => {
    seedLoggedInSession();
    const { createTask } = installTaskApi({ tasks: [] });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Draft launch checklist");
    await userEvent.selectOptions(within(dialog).getByLabelText("Assignee"), ASSIGNEE.user_id);
    await userEvent.selectOptions(within(dialog).getByLabelText("Priority"), "high");
    await userEvent.type(within(dialog).getByLabelText("Due date"), "2026-09-03T09:30");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(parseBody(createTask.mock.calls[0][1])).toMatchObject({
      title: "Draft launch checklist",
      assignee_id: ASSIGNEE.user_id,
      priority: "high",
    });
    expect(await screen.findByRole("dialog", { name: "Edit task" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Draft launch checklist")).toBeInTheDocument();
  });

  it("prevents empty task titles and surfaces create failures", async () => {
    seedLoggedInSession();
    const createTask = vi.fn(() =>
      new Response(JSON.stringify({ detail: "Cannot create task" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    installTaskApi({
      tasks: [],
      overrides: { "POST /workspaces/w1/projects/p1/tasks": createTask },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    expect(within(dialog).getByRole("button", { name: "Create task" })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("Title"), "Broken task");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Couldn't create task")).toBeInTheDocument();
    expect(screen.getByText("Cannot create task")).toBeInTheDocument();
  });

  it("edits title, status, priority, assignee, and due date with typed task payloads", async () => {
    seedLoggedInSession();
    const { updateTask } = installTaskApi({
      tasks: [
        task({
          id: "t1",
          title: "Draft plan",
          priority: "medium",
          status: "todo",
          assignee_id: null,
          due_at: null,
        }),
      ],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1?task=t1" });

    const drawer = await screen.findByRole("dialog", { name: "Edit task" });
    const titleInput = within(drawer).getByLabelText("Task title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Draft better plan");
    await userEvent.tab();

    await userEvent.selectOptions(within(drawer).getByLabelText("Task status"), "in_progress");
    await userEvent.selectOptions(within(drawer).getByLabelText("Task priority"), "urgent");
    await userEvent.selectOptions(within(drawer).getByLabelText("Task assignee"), ASSIGNEE.user_id);
    await userEvent.type(within(drawer).getByLabelText("Task due date"), "2026-09-05T10:15");

    await waitFor(() => expect(updateTask).toHaveBeenCalled());
    const payloads = updateTask.mock.calls.map((call) => parseBody(call[1]));
    expect(payloads).toContainEqual({ title: "Draft better plan" });
    expect(payloads).toContainEqual({ status: "in_progress" });
    expect(payloads).toContainEqual({ priority: "urgent" });
    expect(payloads).toContainEqual({ assignee_id: ASSIGNEE.user_id });
    expect(payloads.some((payload) => typeof payload.due_at === "string")).toBe(true);
  });

  it("surfaces task edit failures without leaving optimistic status behind", async () => {
    seedLoggedInSession();
    installTaskApi({
      tasks: [task({ id: "t1", title: "Draft plan", status: "todo" })],
      overrides: {
        "PATCH /workspaces/w1/projects/p1/tasks/t1": () =>
          new Response(JSON.stringify({ detail: "Cannot update task" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1?task=t1" });

    const drawer = await screen.findByRole("dialog", { name: "Edit task" });
    const status = within(drawer).getByLabelText("Task status");
    await userEvent.selectOptions(status, "done");

    expect(await screen.findByText("Update failed")).toBeInTheDocument();
    expect(screen.getByText("Cannot update task")).toBeInTheDocument();
    await waitFor(() => expect(status).toHaveValue("todo"));
  });

  it("hides and disables task mutation controls for viewers", async () => {
    seedLoggedInSession();
    installTaskApi({
      workspace: VIEWER_WORKSPACE,
      tasks: [task({ id: "t1", title: "Read only task", status: "todo" })],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1?task=t1" });

    expect(await screen.findByRole("heading", { name: "Launch Plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New task" })).not.toBeInTheDocument();
    const drawer = await screen.findByRole("dialog", { name: "Task" });
    expect(within(drawer).queryByLabelText("Task title")).not.toBeInTheDocument();
    expect(within(drawer).getByLabelText("Task status")).toBeDisabled();
    expect(within(drawer).getByLabelText("Task priority")).toBeDisabled();
    expect(within(drawer).getByLabelText("Task assignee")).toBeDisabled();
    expect(within(drawer).getByLabelText("Task due date")).toBeDisabled();
  });
});
