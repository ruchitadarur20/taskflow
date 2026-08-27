import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";
import { mockApi, renderWithProviders, seedLoggedInSession, TEST_TOKENS } from "../test/utils";
import type { ActivityEvent, Project, Task } from "../api/projects";
import type { Notification } from "../api/notifications";
import type { Workspace, WorkspaceMember } from "../api/workspaces";

const realtime = vi.hoisted(() => ({
  currentWorkspaceId: undefined as string | undefined,
  handler: undefined as ((event: {
    event_type: string;
    workspace_id: string;
    project_id: string | null;
    task_id: string | null;
  }) => void) | undefined,
}));

vi.mock("../hooks/useRealtimeSubscriptions", () => ({
  useWorkspaceChannel: vi.fn((workspaceId: string | undefined) => {
    realtime.currentWorkspaceId = workspaceId;
  }),
  useRealtimeEvent: vi.fn((_types: string[] | null, handler: typeof realtime.handler) => {
    realtime.handler = handler;
  }),
}));

const NOW = "2026-09-01T14:00:00.000Z";

const WORKSPACE_ONE: Workspace = {
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

const WORKSPACE_TWO: Workspace = {
  ...WORKSPACE_ONE,
  id: "w2",
  name: "Ops Team",
  slug: "ops-team",
};

const PROJECT_ONE: Project = {
  id: "p1",
  workspace_id: "w1",
  created_by_id: TEST_TOKENS.user.id,
  name: "Launch Plan",
  description: "Public launch work",
  slug: "launch-plan",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
  archived_at: null,
};

const PROJECT_TWO: Project = {
  ...PROJECT_ONE,
  id: "p2",
  name: "Design Polish",
  description: null,
  slug: "design-polish",
};

const PROJECT_THREE: Project = {
  ...PROJECT_ONE,
  id: "p3",
  workspace_id: "w2",
  name: "Ops Runbook",
  slug: "ops-runbook",
};

const OWNER: WorkspaceMember = {
  id: "m1",
  workspace_id: "w1",
  user_id: TEST_TOKENS.user.id,
  role: "owner",
  created_at: NOW,
  updated_at: NOW,
  user: TEST_TOKENS.user,
};

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    workspace_id: overrides.workspace_id ?? "w1",
    project_id: overrides.project_id ?? "p1",
    parent_task_id: null,
    created_by_id: TEST_TOKENS.user.id,
    assignee_id: TEST_TOKENS.user.id,
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

function activity(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: overrides.id ?? "a1",
    workspace_id: overrides.workspace_id ?? "w1",
    project_id: overrides.project_id ?? "p1",
    task_id: overrides.task_id ?? null,
    actor_id: TEST_TOKENS.user.id,
    event_type: "task.created",
    metadata_json: {},
    created_at: overrides.created_at ?? NOW,
    ...overrides,
  };
}

function notification(overrides: Partial<Notification>): Notification {
  return {
    id: overrides.id ?? "n1",
    workspace_id: overrides.workspace_id ?? "w1",
    project_id: overrides.project_id ?? null,
    task_id: overrides.task_id ?? null,
    actor_id: null,
    type: "task.assignee_changed",
    title: "You were assigned to a task",
    body: null,
    payload_json: {},
    read_at: null,
    created_at: overrides.created_at ?? NOW,
    ...overrides,
  };
}

function DashboardRoutes() {
  return (
    <Routes>
      <Route path="/w/:workspaceId" element={<DashboardPage />} />
      <Route path="/w/:workspaceId/projects/:projectId" element={<p>Project detail</p>} />
    </Routes>
  );
}

function SwitchableDashboardRoutes() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/w/w2")}>
        Switch workspace
      </button>
      <DashboardRoutes />
    </>
  );
}

function installDashboardApi({
  workspaces = [WORKSPACE_ONE, WORKSPACE_TWO],
  projectsByWorkspace = {
    w1: [PROJECT_ONE, PROJECT_TWO],
    w2: [PROJECT_THREE],
  },
  tasksByProject = {
    p1: [
      task({ id: "t-overdue", title: "Fix overdue task", due_at: "2020-01-01T14:00:00.000Z" }),
      task({ id: "t-week", title: "Finish this week", due_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
    ],
    p2: [task({ id: "t-done", project_id: "p2", title: "Completed work", status: "done" })],
    p3: [task({ id: "t-ops", workspace_id: "w2", project_id: "p3", title: "Ops task" })],
  },
  activityByProject = {
    p1: [activity({ id: "a1", event_type: "task.created", created_at: "2026-09-01T14:00:00.000Z" })],
    p2: [activity({ id: "a2", project_id: "p2", event_type: "task.status_changed", created_at: "2026-09-01T15:00:00.000Z" })],
    p3: [activity({ id: "a3", workspace_id: "w2", project_id: "p3", created_at: "2026-09-01T16:00:00.000Z" })],
  },
  notifications = [notification({ id: "n1", title: "Task moved" })],
  overrides = {},
}: {
  workspaces?: Workspace[];
  projectsByWorkspace?: Record<string, Project[]>;
  tasksByProject?: Record<string, Task[]>;
  activityByProject?: Record<string, ActivityEvent[]>;
  notifications?: Notification[];
  overrides?: Record<string, (url: URL, init?: RequestInit) => unknown | Promise<unknown>>;
} = {}) {
  const projectCalls = vi.fn((workspaceId: string) => projectsByWorkspace[workspaceId] ?? []);
  const taskCalls = vi.fn((projectId: string) => tasksByProject[projectId] ?? []);
  const activityCalls = vi.fn((projectId: string) => activityByProject[projectId] ?? []);
  const notificationCalls = vi.fn(() => notifications);

  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces": () => workspaces,
    "GET /workspaces/w1": () => workspaces.find((workspace) => workspace.id === "w1"),
    "GET /workspaces/w2": () => workspaces.find((workspace) => workspace.id === "w2"),
    "GET /workspaces/w1/projects": () => projectCalls("w1"),
    "GET /workspaces/w2/projects": () => projectCalls("w2"),
    "GET /workspaces/w1/projects/p1/tasks": () => taskCalls("p1"),
    "GET /workspaces/w1/projects/p2/tasks": () => taskCalls("p2"),
    "GET /workspaces/w2/projects/p3/tasks": () => taskCalls("p3"),
    "GET /workspaces/w1/projects/p1/activity": () => activityCalls("p1"),
    "GET /workspaces/w1/projects/p2/activity": () => activityCalls("p2"),
    "GET /workspaces/w2/projects/p3/activity": () => activityCalls("p3"),
    "GET /workspaces/w1/members": () => [OWNER],
    "GET /workspaces/w2/members": () => [{ ...OWNER, workspace_id: "w2" }],
    "GET /notifications": (_url) => notificationCalls(),
    "GET /notifications/unread-count": () => ({ unread_count: 1 }),
    ...overrides,
  });

  return { projectCalls, taskCalls, activityCalls, notificationCalls };
}

beforeEach(() => {
  realtime.currentWorkspaceId = undefined;
  realtime.handler = undefined;
});

describe("DashboardPage", () => {
  it("renders summary data, task groups, notifications, and activity", async () => {
    seedLoggedInSession();
    installDashboardApi();

    renderWithProviders(<DashboardRoutes />, { route: "/w/w1" });

    expect(await screen.findByRole("heading", { name: /Welcome back, Owner/ })).toBeInTheDocument();
    expect(screen.getByText("Launch Plan")).toBeInTheDocument();
    expect(screen.getByText("Design Polish")).toBeInTheDocument();
    expect(await screen.findByText("Fix overdue task")).toBeInTheDocument();
    expect(await screen.findByText("Finish this week")).toBeInTheDocument();
    expect(screen.getByText("Task moved")).toBeInTheDocument();
    expect(screen.getByText(/changed a task's status/)).toBeInTheDocument();

    expect(screen.getByRole("group", { name: "Assigned to me: 3" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Overdue: 1" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Due this week: 1" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Completed: 1" })).toBeInTheDocument();
  });

  it("shows useful empty states for a workspace with no projects", async () => {
    seedLoggedInSession();
    installDashboardApi({ projectsByWorkspace: { w1: [], w2: [PROJECT_THREE] } });

    renderWithProviders(<DashboardRoutes />, { route: "/w/w1" });

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing overdue. Nice work.")).toBeInTheDocument();
    expect(screen.getByText("No upcoming tasks assigned to you.")).toBeInTheDocument();
    expect(screen.getByText("No recent activity.")).toBeInTheDocument();
  });

  it("shows an access state when the workspace cannot be loaded", async () => {
    seedLoggedInSession();
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
      "GET /workspaces": () => [],
      "GET /workspaces/missing-workspace": () =>
        new Response(JSON.stringify({ detail: "Workspace not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      "GET /notifications": () => [],
      "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    });

    renderWithProviders(<DashboardRoutes />, { route: "/w/missing-workspace" });

    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(
      screen.getByText("This workspace doesn't exist, or you don't have access to it."),
    ).toBeInTheDocument();
  });

  it("surfaces aggregate request failures without a blank page", async () => {
    seedLoggedInSession();
    installDashboardApi({
      overrides: {
        "GET /workspaces/w1/projects/p1/tasks": () =>
          new Response(JSON.stringify({ detail: "Task aggregation failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        "GET /workspaces/w1/projects/p2/tasks": () =>
          new Response(JSON.stringify({ detail: "Task aggregation failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<DashboardRoutes />, { route: "/w/w1" });

    expect(await screen.findAllByText("Task aggregation failed")).toHaveLength(2);
    expect(screen.getByText("Recent projects")).toBeInTheDocument();
  });

  it("keeps partial aggregate data visible when one project fails", async () => {
    seedLoggedInSession();
    installDashboardApi({
      overrides: {
        "GET /workspaces/w1/projects/p2/tasks": () =>
          new Response(JSON.stringify({ detail: "Project tasks failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<DashboardRoutes />, { route: "/w/w1" });

    expect(await screen.findByText("1 project task list could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Fix overdue task")).toBeInTheDocument();
  });

  it("switches workspace data without showing stale task summaries", async () => {
    seedLoggedInSession();
    installDashboardApi();

    renderWithProviders(<SwitchableDashboardRoutes />, { route: "/w/w1" });
    expect(await screen.findByText("Launch Plan")).toBeInTheDocument();
    expect(await screen.findByText("Fix overdue task")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Switch workspace" }));

    expect(await screen.findByText("Ops Runbook")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Fix overdue task")).not.toBeInTheDocument());
    expect(screen.getByText("Ops task")).toBeInTheDocument();
  });

  it("refreshes dashboard aggregates and notifications for current-workspace realtime events", async () => {
    seedLoggedInSession();
    const { taskCalls, activityCalls, notificationCalls } = installDashboardApi();

    renderWithProviders(<DashboardRoutes />, { route: "/w/w1" });
    expect(await screen.findByText("Launch Plan")).toBeInTheDocument();

    realtime.handler?.({
      event_type: "task.updated",
      workspace_id: "w1",
      project_id: "p1",
      task_id: "t-overdue",
    });
    realtime.handler?.({
      event_type: "notification.created",
      workspace_id: "w1",
      project_id: "p1",
      task_id: "t-overdue",
    });
    realtime.handler?.({
      event_type: "task.updated",
      workspace_id: "w2",
      project_id: "p3",
      task_id: "t-ops",
    });

    await waitFor(() => expect(taskCalls.mock.calls.filter((call) => call[0] === "p1")).toHaveLength(2));
    await waitFor(() => expect(activityCalls.mock.calls.filter((call) => call[0] === "p1")).toHaveLength(2));
    await waitFor(() => expect(notificationCalls).toHaveBeenCalledTimes(2));
    expect(realtime.currentWorkspaceId).toBe("w1");
  });
});
