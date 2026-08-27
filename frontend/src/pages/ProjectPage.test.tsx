import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../components/auth/RequireAuth";
import { AppLayout } from "../components/layout/AppLayout";
import { TEST_TOKENS, mockApi, renderWithProviders, seedLoggedInSession } from "../test/utils";
import { ProjectPage } from "./ProjectPage";

const OWNER_WORKSPACE = {
  id: "w1",
  owner_id: TEST_TOKENS.user.id,
  name: "Design Team",
  slug: "design-team",
  status: "active",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived_at: null,
  current_user_role: "owner",
};

const VIEWER_WORKSPACE = {
  ...OWNER_WORKSPACE,
  current_user_role: "viewer",
};

const PROJECT_ALPHA = {
  id: "p1",
  workspace_id: "w1",
  created_by_id: TEST_TOKENS.user.id,
  name: "Project Alpha",
  description: "Launch work",
  slug: "project-alpha",
  status: "active",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  archived_at: null,
};

const PROJECT_BETA = {
  ...PROJECT_ALPHA,
  id: "p2",
  name: "Project Beta",
  slug: "project-beta",
};

const MEMBER = {
  id: "m1",
  workspace_id: "w1",
  user_id: TEST_TOKENS.user.id,
  role: "owner",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  user: TEST_TOKENS.user,
};

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
  projects = [PROJECT_ALPHA, PROJECT_BETA],
  project = PROJECT_ALPHA,
  tasks = [],
  members = [MEMBER],
  overrides = {},
}: {
  workspace?: typeof OWNER_WORKSPACE;
  projects?: unknown[];
  project?: unknown;
  tasks?: unknown[];
  members?: unknown[];
  overrides?: Record<string, () => unknown>;
} = {}) {
  const createProject = vi.fn(() => PROJECT_BETA);
  const updateProject = vi.fn(() => ({ ...PROJECT_ALPHA, name: "Renamed Alpha" }));

  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces": () => [workspace],
    "GET /workspaces/w1": () => workspace,
    "GET /workspaces/w1/projects": () => projects,
    "GET /workspaces/w1/projects/p1": () => project,
    "GET /workspaces/w1/projects/p2": () => PROJECT_BETA,
    "GET /workspaces/w1/projects/p1/tasks": () => tasks,
    "GET /workspaces/w1/projects/p2/tasks": () => [],
    "GET /workspaces/w1/members": () => members,
    "GET /notifications": () => [],
    "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    "POST /workspaces/w1/projects": createProject,
    "PATCH /workspaces/w1/projects/p1": updateProject,
    ...overrides,
  });

  return { createProject, updateProject };
}

describe("ProjectPage", () => {
  it("renders project details and active project navigation", async () => {
    seedLoggedInSession();
    installProjectApi();

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByRole("heading", { name: "Project Alpha" })).toBeInTheDocument();
    expect(screen.getByText("Launch work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Project Alpha/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows a loading state while project data loads", async () => {
    seedLoggedInSession();
    installProjectApi({
      overrides: {
        "GET /workspaces/w1/projects/p1": () => new Promise(() => undefined),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await waitFor(() => {
      expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Project Alpha" })).not.toBeInTheDocument();
  });

  it("shows the project access state for backend 403 responses", async () => {
    seedLoggedInSession();
    installProjectApi({
      overrides: {
        "GET /workspaces/w1/projects/p1": () =>
          new Response(JSON.stringify({ detail: "Not authorized" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.getByText("This project doesn't exist, or you don't have access to it.")).toBeInTheDocument();
  });

  it("shows the project access state for backend 404 responses", async () => {
    seedLoggedInSession();
    installProjectApi({
      overrides: {
        "GET /workspaces/w1/projects/p1": () =>
          new Response(JSON.stringify({ detail: "Resource not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
  });

  it("creates a project from the sidebar and routes to it", async () => {
    seedLoggedInSession();
    const { createProject } = installProjectApi({ projects: [PROJECT_ALPHA] });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    await userEvent.type(within(dialog).getByPlaceholderText("Project name"), "Project Beta");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Project Beta" })).toBeInTheDocument();
  });

  it("surfaces project creation errors", async () => {
    seedLoggedInSession();
    installProjectApi({
      overrides: {
        "POST /workspaces/w1/projects": () =>
          new Response(JSON.stringify({ detail: "Project already exists" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    await userEvent.type(within(dialog).getByPlaceholderText("Project name"), "Project Alpha");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Couldn't create project")).toBeInTheDocument();
    expect(screen.getByText("Project already exists")).toBeInTheDocument();
  });

  it("edits project details", async () => {
    seedLoggedInSession();
    const { updateProject } = installProjectApi();

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    await userEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    await userEvent.clear(within(dialog).getByLabelText("Name"));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Renamed Alpha");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Project updated")).toBeInTheDocument();
  });

  it("hides project edit controls for viewers", async () => {
    seedLoggedInSession();
    installProjectApi({ workspace: VIEWER_WORKSPACE });

    renderWithProviders(<ProjectRoutes />, { route: "/w/w1/projects/p1" });

    expect(await screen.findByRole("heading", { name: "Project Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New task/ })).not.toBeInTheDocument();
  });
});
