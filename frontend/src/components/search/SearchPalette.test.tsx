import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SearchPalette } from "./SearchPalette";
import { mockApi, renderWithProviders, seedLoggedInSession, TEST_TOKENS } from "../../test/utils";
import type { Project, Task } from "../../api/projects";

const NOW = "2026-09-01T14:00:00.000Z";

const PROJECT: Project = {
  id: "p1",
  workspace_id: "w1",
  created_by_id: TEST_TOKENS.user.id,
  name: "Launch Plan",
  description: "Launch work",
  slug: "launch-plan",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
  archived_at: null,
};

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    workspace_id: "w1",
    project_id: "p1",
    parent_task_id: null,
    created_by_id: TEST_TOKENS.user.id,
    assignee_id: null,
    title: "Draft checklist",
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

function LocationMarker() {
  const location = useLocation();
  return <p>Location: {location.pathname}{location.search}</p>;
}

function SearchRoutes({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <Routes>
      <Route
        path="/w/:workspaceId"
        element={
          <>
            <SearchPalette workspaceId="w1" onClose={onClose} />
            <LocationMarker />
          </>
        }
      />
      <Route path="/w/:workspaceId/projects/:projectId" element={<LocationMarker />} />
    </Routes>
  );
}

function installSearchApi(
  overrides: Record<string, (url: URL, init?: RequestInit) => unknown | Promise<unknown>> = {},
) {
  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces/w1/projects": () => [PROJECT],
    "GET /workspaces/w1/projects/p1/tasks": () => [task({ id: "t1" })],
    ...overrides,
  });
}

describe("SearchPalette", () => {
  it("renders project and task results scoped to the workspace", async () => {
    seedLoggedInSession();
    installSearchApi();

    renderWithProviders(<SearchRoutes />, { route: "/w/w1" });

    await userEvent.type(screen.getByRole("textbox", { name: "Search projects and tasks" }), "launch");

    expect(await screen.findByRole("button", { name: "Launch Plan" })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("textbox", { name: "Search projects and tasks" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search projects and tasks" }), "draft");

    expect(await screen.findByRole("button", { name: "Draft checklist" })).toBeInTheDocument();
  });

  it("closes after navigating to a result", async () => {
    seedLoggedInSession();
    installSearchApi();
    const onClose = vi.fn();

    renderWithProviders(<SearchRoutes onClose={onClose} />, { route: "/w/w1" });

    await userEvent.type(screen.getByRole("textbox", { name: "Search projects and tasks" }), "draft");
    await userEvent.click(await screen.findByRole("button", { name: "Draft checklist" }));

    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText("Location: /w/w1/projects/p1?task=t1")).toBeInTheDocument();
  });

  it("shows an empty state without looking like blank search", async () => {
    seedLoggedInSession();
    installSearchApi();

    renderWithProviders(<SearchRoutes />, { route: "/w/w1" });

    await userEvent.type(screen.getByRole("textbox", { name: "Search projects and tasks" }), "missing");
    expect(await screen.findByText('No matches for "missing".')).toBeInTheDocument();
  });

  it("surfaces task aggregation failures", async () => {
    seedLoggedInSession();
    installSearchApi({
      "GET /workspaces/w1/projects/p1/tasks": () =>
        new Response(JSON.stringify({ detail: "Search failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    });

    renderWithProviders(<SearchRoutes />, { route: "/w/w1" });

    await userEvent.type(screen.getByRole("textbox", { name: "Search projects and tasks" }), "draft");

    expect(await screen.findByText("Search failed")).toBeInTheDocument();
  });
});
