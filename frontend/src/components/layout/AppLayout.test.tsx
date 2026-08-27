import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../auth/RequireAuth";
import { AppLayout } from "./AppLayout";
import {
  mockApi,
  renderWithProviders,
  seedLoggedInSession,
  TEST_TOKENS,
  makeTestQueryClient,
} from "../../test/utils";

const WORKSPACES = [
  {
    id: "w1",
    owner_id: TEST_TOKENS.user.id,
    name: "Design Team",
    slug: "design-team",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    current_user_role: "owner",
  },
  {
    id: "w2",
    owner_id: TEST_TOKENS.user.id,
    name: "Engineering",
    slug: "engineering",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    current_user_role: "admin",
  },
] as const;

const PROJECTS = [
  {
    id: "p1",
    workspace_id: "w1",
    created_by_id: TEST_TOKENS.user.id,
    name: "Project Alpha",
    description: null,
    slug: "project-alpha",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
  },
] as const;

function WorkspaceMarker() {
  return <p>Workspace route content</p>;
}

function ShellRoutes() {
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
        <Route path="/w/:workspaceId" element={<WorkspaceMarker />} />
        <Route path="/w/:workspaceId/projects/:projectId" element={<p>Project route content</p>} />
      </Route>
    </Routes>
  );
}

function installShellApi(overrides: Record<string, () => unknown> = {}) {
  const logout = vi.fn(() => undefined);
  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces": () => WORKSPACES,
    "GET /workspaces/w1": () => WORKSPACES[0],
    "GET /workspaces/w2": () => WORKSPACES[1],
    "GET /workspaces/w1/projects": () => PROJECTS,
    "GET /workspaces/w2/projects": () => [],
    "GET /workspaces/w1/projects/p1": () => PROJECTS[0],
    "GET /notifications": () => [],
    "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    "POST /auth/logout": logout,
    ...overrides,
  });
  return { logout };
}

describe("AppLayout shell", () => {
  it("keeps unauthenticated users out of protected shell routes", async () => {
    mockApi({});

    renderWithProviders(<ShellRoutes />, { route: "/w/w1" });

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("renders the authenticated shell with topbar controls and user menu", async () => {
    seedLoggedInSession();
    installShellApi();

    renderWithProviders(<ShellRoutes />, { route: "/w/w1" });

    expect(await screen.findByText("Workspace route content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Owner Person/ })).toBeInTheDocument();
  });

  it("marks the active navigation item for the current route", async () => {
    seedLoggedInSession();
    installShellApi();

    renderWithProviders(<ShellRoutes />, { route: "/w/w1/projects/p1" });

    const projectLink = await screen.findByRole("link", { name: /Project Alpha/ });
    expect(projectLink).toHaveAttribute("aria-current", "page");
  });

  it("switches workspace from the workspace menu", async () => {
    seedLoggedInSession();
    installShellApi();

    renderWithProviders(<ShellRoutes />, { route: "/w/w1" });

    await userEvent.click(await screen.findByRole("button", { name: /Design Team/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Engineering" }));

    expect(await screen.findByRole("button", { name: /Engineering/ })).toBeInTheDocument();
  });

  it("clears user-specific query cache and redirects after logout", async () => {
    seedLoggedInSession();
    const { logout } = installShellApi();
    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(["workspaces"], WORKSPACES);

    renderWithProviders(<ShellRoutes />, { route: "/w/w1", queryClient });

    await userEvent.click(await screen.findByRole("button", { name: /Owner Person/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(queryClient.getQueryData(["workspaces"])).toBeUndefined();
  });

  it("opens mobile navigation and closes it after navigation", async () => {
    seedLoggedInSession();
    installShellApi();

    renderWithProviders(<ShellRoutes />, { route: "/w/w1" });

    await userEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });

    await userEvent.click(within(dialog).getByRole("link", { name: /Project Alpha/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Project route content")).toBeInTheDocument();
  });

  it("persists theme changes from the user menu", async () => {
    seedLoggedInSession();
    installShellApi();

    renderWithProviders(<ShellRoutes />, { route: "/w/w1" });

    await userEvent.click(await screen.findByRole("button", { name: /Owner Person/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Dark/ }));

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("taskflow.theme")).toBe("dark");
  });
});
