import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityEntry } from "./ActivityEntry";
import type { ActivityEvent } from "../../api/projects";

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "a1",
    workspace_id: "w1",
    project_id: "p1",
    task_id: "t1",
    actor_id: "u1",
    event_type: "task.status_changed",
    metadata_json: { status: { old: "todo", new: "done" } },
    created_at: "2026-09-01T14:00:00.000Z",
    ...overrides,
  };
}

describe("ActivityEntry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders meaningful activity text with an actor and timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T15:00:00.000Z"));

    const { container } = render(<ActivityEntry event={event()} actorName="Owner Person" />);

    expect(container).toHaveTextContent('Owner Person moved a task from "todo" to "done"');
    expect(screen.getByText("about 1 hour ago")).toBeInTheDocument();
  });

  it("falls back for unknown activity events without crashing", () => {
    const { container } = render(
      <ActivityEntry event={event({ event_type: "system.unrecognized", metadata_json: {} })} />,
    );

    expect(container).toHaveTextContent("Someone system unrecognized");
  });
});
