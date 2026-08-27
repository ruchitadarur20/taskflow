import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppLayout } from "../layout/AppLayout";
import { RequireAuth } from "../auth/RequireAuth";
import { ProjectPage } from "../../pages/ProjectPage";
import { TEST_TOKENS, mockApi, renderWithProviders, seedLoggedInSession } from "../../test/utils";
import type { Task, TaskPriority, TaskStatus } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

const dndEvents = vi.hoisted(() => ({
  onDragStart: undefined as ((event: { active: { id: string } }) => void) | undefined,
  onDragEnd: undefined as
    | ((event: { active: { id: string }; over: { id: string } | null }) => void)
    | undefined,
}));

vi.mock("@dnd-kit/core", async () => {
  type DndProps = {
    children: React.ReactNode;
    onDragStart?: (event: { active: { id: string } }) => void;
    onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => void;
  };
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({ children, onDragStart, onDragEnd }: DndProps) => {
      dndEvents.onDragStart = onDragStart;
      dndEvents.onDragEnd = onDragEnd;
      return (
        <div>
          {children}
          <button
            type="button"
            onClick={() => {
              onDragStart?.({ active: { id: "t1" } });
              onDragEnd?.({ active: { id: "t1" }, over: { id: "done" } });
            }}
          >
            Move t1 to done
          </button>
          <button
            type="button"
            onClick={() => onDragEnd?.({ active: { id: "t1" }, over: { id: "todo" } })}
          >
            Move t1 to todo
          </button>
          <button
            type="button"
            onClick={() => onDragEnd?.({ active: { id: "t1" }, over: null })}
          >
            Drop t1 nowhere
          </button>
        </div>
      );
    },
    DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
    useSensor: vi.fn((sensor: unknown, options?: unknown) => ({ sensor, options })),
    useSensors: vi.fn((...sensors: unknown[]) => sensors),
  };
});

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

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
const PROJECT_ALPHA = {
  id: "p1",
  workspace_id: "w1",
  created_by_id: TEST_TOKENS.user.id,
  name: "Project Alpha",
  description: "Launch work",
  slug: "project-alpha",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
  archived_at: null,
};
const PROJECT_BETA = { ...PROJECT_ALPHA, id: "p2", name: "Project Beta", slug: "project-beta" };
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
    project_id: overrides.project_id ?? "p1",
    parent_task_id: null,
    created_by_id: TEST_TOKENS.user.id,
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
  return init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
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

function installProjectApi({
  workspace = OWNER_WORKSPACE,
  p1Tasks = [
    task({ id: "t1", title: "Backlog item", status: "todo" }),
    task({ id: "t2", title: "Doing item", status: "in_progress", priority: "high" }),
    task({ id: "t3", title: "Blocked item", status: "blocked" }),
    task({ id: "t4", title: "Done item", status: "done" }),
    task({ id: "t5", title: "Archived item", status: "archived", archived_at: NOW }),
  ],
  p2Tasks = [task({ id: "t6", project_id: "p2", title: "Other project task", status: "todo" })],
  overrides = {},
}: {
  workspace?: typeof OWNER_WORKSPACE;
  p1Tasks?: Task[];
  p2Tasks?: Task[];
  overrides?: Record<string, (url: URL, init?: RequestInit) => unknown | Promise<unknown>>;
} = {}) {
  const p1State = p1Tasks.filter((item) => item.status !== "archived" && item.archived_at === null);
  const p2State = [...p2Tasks];
  const details = new Map([...p1State, ...p2State].map((item) => [item.id, item]));

  const updateTask = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const current = details.get("t1");
    if (!current) {
      return new Response(JSON.stringify({ detail: "Task not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const updated = { ...current, ...body, updated_at: "2026-09-02T14:00:00.000Z" } as Task;
    details.set("t1", updated);
    const index = p1State.findIndex((item) => item.id === "t1");
    if (index >= 0) p1State[index] = updated;
    return updated;
  });

  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces": () => [workspace],
    "GET /workspaces/w1": () => workspace,
    "GET /workspaces/w1/projects": () => [PROJECT_ALPHA, PROJECT_BETA],
    "GET /workspaces/w1/projects/p1": () => PROJECT_ALPHA,
    "GET /workspaces/w1/projects/p2": () => PROJECT_BETA,
    "GET /workspaces/w1/projects/p1/tasks": () => p1State,
    "GET /workspaces/w1/projects/p2/tasks": () => p2State,
    "GET /workspaces/w1/projects/p1/tasks/t1": () => details.get("t1"),
    "GET /workspaces/w1/projects/p1/tasks/t2": () => details.get("t2"),
    "GET /workspaces/w1/projects/p2/tasks/t6": () => details.get("t6"),
    "GET /workspaces/w1/projects/p1/labels": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t1/labels": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t2/labels": () => [],
    "GET /workspaces/w1/projects/p2/tasks/t6/labels": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t1/dependencies": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t2/dependencies": () => [],
    "GET /workspaces/w1/projects/p2/tasks/t6/dependencies": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t1/comments": () => [],
    "GET /workspaces/w1/projects/p1/tasks/t2/comments": () => [],
    "GET /workspaces/w1/projects/p2/tasks/t6/comments": () => [],
    "GET /workspaces/w1/projects/p1/activity": () => [],
    "GET /workspaces/w1/projects/p2/activity": () => [],
    "GET /workspaces/w1/members": () => [MEMBER, ASSIGNEE],
    "GET /notifications": () => [],
    "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    "PATCH /workspaces/w1/projects/p1/tasks/t1": updateTask,
    ...overrides,
  });

  return { updateTask, p1State };
}

describe("Kanban board and task details", () => {
  it("renders visible backend status columns, counts, tasks, and empty column states", async () => {
    seedLoggedInSession();
    installProjectApi();

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    const todo = await screen.findByLabelText("To do column");
    expect(within(todo).getByText("Backlog item")).toBeInTheDocument();
    expect(within(todo).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByLabelText("In progress column")).getByText("Doing item")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Blocked column")).getByText("Blocked item")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Done column")).getByText("Done item")).toBeInTheDocument();
    expect(screen.queryByLabelText("Archived column")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived item")).not.toBeInTheDocument();
  });

  it("renders empty board columns without implying ordering support", async () => {
    seedLoggedInSession();
    installProjectApi({ p1Tasks: [] });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByLabelText("To do column")).toBeInTheDocument();
    expect(screen.getAllByText("Drop tasks here")).toHaveLength(4);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("moves a task between status columns and sends only the status payload", async () => {
    seedLoggedInSession();
    const { updateTask } = installProjectApi({
      p1Tasks: [task({ id: "t1", title: "Backlog item", status: "todo" })],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "Move t1 to done" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(parseBody(updateTask.mock.calls[0][1])).toEqual({ status: "done" });
    await waitFor(() =>
      expect(within(screen.getByLabelText("Done column")).getByText("Backlog item")).toBeInTheDocument(),
    );
  });

  it("does not mutate when a task is dropped into its current column or nowhere", async () => {
    seedLoggedInSession();
    const { updateTask } = installProjectApi({
      p1Tasks: [task({ id: "t1", title: "Backlog item", status: "todo" })],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "Move t1 to todo" }));
    await userEvent.click(screen.getByRole("button", { name: "Drop t1 nowhere" }));

    expect(updateTask).not.toHaveBeenCalled();
  });

  it("rolls back the board and surfaces drag failure errors", async () => {
    seedLoggedInSession();
    installProjectApi({
      p1Tasks: [task({ id: "t1", title: "Backlog item", status: "todo" })],
      overrides: {
        "PATCH /workspaces/w1/projects/p1/tasks/t1": () =>
          new Response(JSON.stringify({ detail: "Cannot move task" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "Move t1 to done" }));

    expect(await screen.findByText("Couldn't move task")).toBeInTheDocument();
    expect(screen.getByText("Cannot move task")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByLabelText("To do column")).getByText("Backlog item")).toBeInTheDocument(),
    );
  });

  it("does not expose drag mutation affordances to viewers", async () => {
    seedLoggedInSession();
    installProjectApi({
      workspace: VIEWER_WORKSPACE,
      p1Tasks: [task({ id: "t1", title: "Backlog item", status: "todo" })],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByRole("button", { name: "Open task Backlog item" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move t1 to done" })).not.toBeInTheDocument();
  });

  it("opens and closes the task detail drawer from a task card", async () => {
    seedLoggedInSession();
    installProjectApi({
      p1Tasks: [
        task({
          id: "t1",
          title: "Backlog item",
          description: "Needs review",
          status: "todo",
          priority: "high",
          assignee_id: ASSIGNEE.user_id,
          due_at: "2026-09-03T15:30:00.000Z",
        }),
      ],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "Open task Backlog item" }));
    const drawer = await screen.findByRole("dialog", { name: "Edit task" });

    expect(within(drawer).getByDisplayValue("Backlog item")).toBeInTheDocument();
    expect(within(drawer).getByDisplayValue("Needs review")).toBeInTheDocument();
    expect(within(drawer).getByLabelText("Task status")).toHaveValue("todo");
    expect(within(drawer).getByLabelText("Task priority")).toHaveValue("high");
    expect(within(drawer).getByLabelText("Task assignee")).toHaveValue(ASSIGNEE.user_id);
    expect(within(drawer).getByLabelText("Task due date")).toHaveValue("2026-09-03T11:30");

    await userEvent.click(within(drawer).getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit task" })).not.toBeInTheDocument());
  });

  it("shows task detail API errors instead of a blank drawer", async () => {
    seedLoggedInSession();
    installProjectApi({
      p1Tasks: [task({ id: "t1", title: "Backlog item", status: "todo" })],
      overrides: {
        "GET /workspaces/w1/projects/p1/tasks/t1": () =>
          new Response(JSON.stringify({ detail: "Task detail failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1?task=t1" });

    const drawer = await screen.findByRole("dialog", { name: "Task" });
    expect(within(drawer).getByText("Task detail failed")).toBeInTheDocument();
  });

  it("closes stale task detail state when navigating to another project", async () => {
    seedLoggedInSession();
    installProjectApi({
      p1Tasks: [task({ id: "t1", title: "Backlog item", status: "todo" })],
      p2Tasks: [task({ id: "t6", project_id: "p2", title: "Other project task", status: "todo" })],
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1?task=t1" });

    expect(await screen.findByRole("dialog", { name: "Edit task" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("link", { name: /Project Beta/ }));

    expect(await screen.findByRole("heading", { name: "Project Beta" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit task" })).not.toBeInTheDocument());
    expect(screen.queryByText("Backlog item")).not.toBeInTheDocument();
    expect(screen.getByText("Other project task")).toBeInTheDocument();
  });
});
