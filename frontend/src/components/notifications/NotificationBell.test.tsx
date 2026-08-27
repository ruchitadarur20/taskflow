import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "./NotificationBell";
import { mockApi, renderWithProviders, seedLoggedInSession, TEST_TOKENS } from "../../test/utils";
import type { Notification } from "../../api/notifications";

const realtime = vi.hoisted(() => ({
  handler: undefined as ((event: { event_type: string; workspace_id: string }) => void) | undefined,
}));

vi.mock("../../hooks/useRealtimeSubscriptions", () => ({
  useRealtimeEvent: vi.fn((_types: string[] | null, handler: typeof realtime.handler) => {
    realtime.handler = handler;
  }),
}));

const NOTIFICATION: Notification = {
  id: "n1",
  workspace_id: "w1",
  project_id: "p1",
  task_id: "t1",
  actor_id: null,
  type: "task.assignee_changed",
  title: "You were assigned to Ship it",
  body: null,
  payload_json: {},
  read_at: null,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  realtime.handler = undefined;
});

describe("NotificationBell", () => {
  it("shows the unread count badge", async () => {
    seedLoggedInSession();
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
      "GET /notifications": () => [NOTIFICATION],
      "GET /notifications/unread-count": () => ({ unread_count: 1 }),
    });

    renderWithProviders(<NotificationBell />);

    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("lists notifications and marks one read on click", async () => {
    seedLoggedInSession();
    const markRead = vi.fn(() => ({ ...NOTIFICATION, read_at: new Date().toISOString() }));
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
      "GET /notifications": () => [NOTIFICATION],
      "GET /notifications/unread-count": () => ({ unread_count: 1 }),
      "POST /notifications/n1/read": markRead,
    });

    renderWithProviders(<NotificationBell />);

    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    const row = await screen.findByRole("button", {
      name: "Mark notification read: You were assigned to Ship it",
    });
    await userEvent.click(row);

    await waitFor(() => expect(markRead).toHaveBeenCalled());
  });

  it("shows an empty state when there are no notifications", async () => {
    seedLoggedInSession();
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
      "GET /notifications": () => [],
      "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    });

    renderWithProviders(<NotificationBell />);

    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it("surfaces notification API failures", async () => {
    seedLoggedInSession();
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
      "GET /notifications": () =>
        new Response(JSON.stringify({ detail: "Notifications failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      "GET /notifications/unread-count": () => ({ unread_count: 0 }),
    });

    renderWithProviders(<NotificationBell />);

    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("Notifications failed")).toBeInTheDocument();
  });

  it("refreshes notifications after realtime notification events", async () => {
    seedLoggedInSession();
    const listNotifications = vi.fn(() => [NOTIFICATION]);
    const unreadCount = vi.fn(() => ({ unread_count: 1 }));
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
      "GET /notifications": listNotifications,
      "GET /notifications/unread-count": unreadCount,
    });

    renderWithProviders(<NotificationBell />);

    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    realtime.handler?.({ event_type: "notification.created", workspace_id: "w1" });

    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(2));
  });
});
