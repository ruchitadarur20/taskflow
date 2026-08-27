import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DueDateLabel, PriorityBadge, StatusBadge } from "./TaskBadges";

describe("TaskBadges", () => {
  it("renders a human-readable status label", () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("renders archived status distinctly from active workflow states", () => {
    render(<StatusBadge status="archived" />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders each priority with its label", () => {
    render(<PriorityBadge priority="urgent" />);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  it("shows 'No due date' when there is none", () => {
    render(<DueDateLabel dueAt={null} />);
    expect(screen.getByText("No due date")).toBeInTheDocument();
  });

  it("marks a past due date as overdue", () => {
    render(<DueDateLabel dueAt={new Date(Date.now() - 86_400_000).toISOString()} />);
    const label = screen.getByText(/\w+ \d+/);
    expect(label.className).toMatch(/text-danger/);
  });

  it("does not mark future due dates as overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));

    render(<DueDateLabel dueAt="2026-09-03T12:00:00.000Z" />);

    const label = screen.getByText(/Sep 3/);
    expect(label.className).not.toMatch(/text-danger/);

    vi.useRealTimers();
  });
});
