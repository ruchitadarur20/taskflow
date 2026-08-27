import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { TEST_TOKENS, mockApi, renderWithProviders, seedLoggedInSession } from "../../test/utils";
import type { Comment, Label, Task, TaskDependency } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

const NOW = "2026-09-01T14:00:00.000Z";

const OWNER: WorkspaceMember = {
  id: "m1",
  workspace_id: "w1",
  user_id: TEST_TOKENS.user.id,
  role: "owner",
  created_at: NOW,
  updated_at: NOW,
  user: TEST_TOKENS.user,
};

const MEMBER: WorkspaceMember = {
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
    created_by_id: TEST_TOKENS.user.id,
    assignee_id: null,
    title: "Parent task",
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

function label(overrides: Partial<Label>): Label {
  return {
    id: overrides.id ?? "l1",
    workspace_id: "w1",
    project_id: "p1",
    name: "Frontend",
    color: "#2f7d6d",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function comment(overrides: Partial<Comment>): Comment {
  return {
    id: overrides.id ?? "c1",
    workspace_id: "w1",
    project_id: "p1",
    task_id: "t1",
    author_id: TEST_TOKENS.user.id,
    body: "Initial comment",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...overrides,
  };
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  return init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
}

function installDrawerApi({
  tasks = [
    task({ id: "t1", title: "Parent task" }),
    task({ id: "t2", title: "Blocking task" }),
    task({ id: "t3", title: "Existing subtask", parent_task_id: "t1", status: "in_progress" }),
  ],
  projectLabels = [label({ id: "l1", name: "Backend" }), label({ id: "l2", name: "Urgent", color: "#b91c1c" })],
  taskLabels = [label({ id: "l1", name: "Backend" })],
  dependencies = [] as TaskDependency[],
  comments = [
    comment({ id: "c1", body: "Owner note" }),
    comment({ id: "c2", author_id: MEMBER.user_id, body: "Member note" }),
  ],
  members = [OWNER, MEMBER],
  overrides = {},
}: {
  tasks?: Task[];
  projectLabels?: Label[];
  taskLabels?: Label[];
  dependencies?: TaskDependency[];
  comments?: Comment[];
  members?: WorkspaceMember[];
  overrides?: Record<string, (url: URL, init?: RequestInit) => unknown | Promise<unknown>>;
} = {}) {
  const taskState = [...tasks];
  const detailState = new Map(taskState.map((item) => [item.id, item]));
  const projectLabelState = [...projectLabels];
  const taskLabelState = [...taskLabels];
  const dependencyState = [...dependencies];
  const commentState = [...comments];

  const addTaskLabel = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const next = projectLabelState.find((item) => item.id === body.label_id);
    if (next && !taskLabelState.some((item) => item.id === next.id)) {
      taskLabelState.push(next);
    }
    return taskLabelState;
  });

  const removeTaskLabel = vi.fn((_url: URL) => {
    const index = taskLabelState.findIndex((item) => item.id === "l1");
    if (index >= 0) taskLabelState.splice(index, 1);
    return undefined;
  });

  const createTask = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const created = task({
      id: "t-created",
      title: String(body.title),
      parent_task_id: body.parent_task_id as string | null,
    });
    taskState.push(created);
    detailState.set(created.id, created);
    return created;
  });

  const addDependency = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const created = {
      blocking_task_id: String(body.blocking_task_id),
      blocked_task_id: "t1",
      created_at: NOW,
    };
    dependencyState.push(created);
    return created;
  });

  const createComment = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const created = comment({ id: "c-created", body: String(body.body) });
    commentState.push(created);
    return created;
  });

  const updateComment = vi.fn((_url: URL, init?: RequestInit) => {
    const body = parseBody(init);
    const target = commentState.find((item) => item.id === "c2");
    if (target) target.body = String(body.body);
    return target;
  });

  const deleteComment = vi.fn((_url: URL) => {
    const index = commentState.findIndex((item) => item.id === "c2");
    if (index >= 0) commentState.splice(index, 1);
    return undefined;
  });

  mockApi({
    "GET /auth/me": () => TEST_TOKENS.user,
    "GET /workspaces/w1/members": () => members,
    "GET /workspaces/w1/projects/p1/tasks": () => taskState,
    "GET /workspaces/w1/projects/p1/tasks/t1": () => detailState.get("t1"),
    "GET /workspaces/w1/projects/p1/tasks/t-created": () => detailState.get("t-created"),
    "GET /workspaces/w1/projects/p1/labels": () => projectLabelState,
    "GET /workspaces/w1/projects/p1/tasks/t1/labels": () => taskLabelState,
    "GET /workspaces/w1/projects/p1/tasks/t1/dependencies": () => dependencyState,
    "GET /workspaces/w1/projects/p1/tasks/t1/comments": () => commentState,
    "GET /workspaces/w1/projects/p1/activity": () => [],
    "POST /workspaces/w1/projects/p1/tasks/t1/labels": addTaskLabel,
    "DELETE /workspaces/w1/projects/p1/tasks/t1/labels/l1": removeTaskLabel,
    "POST /workspaces/w1/projects/p1/tasks": createTask,
    "POST /workspaces/w1/projects/p1/tasks/t1/dependencies": addDependency,
    "POST /workspaces/w1/projects/p1/tasks/t1/comments": createComment,
    "PATCH /workspaces/w1/projects/p1/tasks/t1/comments/c2": updateComment,
    "DELETE /workspaces/w1/projects/p1/tasks/t1/comments/c2": deleteComment,
    ...overrides,
  });

  return { addTaskLabel, removeTaskLabel, createTask, addDependency, createComment, updateComment, deleteComment };
}

function renderDrawer(canEdit = true, onOpenTask = vi.fn()) {
  return renderWithProviders(
    <TaskDetailDrawer
      workspaceId="w1"
      projectId="p1"
      taskId="t1"
      canEdit={canEdit}
      onOpenTask={onOpenTask}
      onClose={vi.fn()}
    />,
  );
}

describe("TaskDetailDrawer advanced features", () => {
  it("adds and removes task labels without hiding mutation failures", async () => {
    seedLoggedInSession();
    const { addTaskLabel, removeTaskLabel } = installDrawerApi();

    renderDrawer();

    expect(await screen.findByText("Backend")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Add existing label"), "l2");

    await waitFor(() => expect(addTaskLabel).toHaveBeenCalledTimes(1));
    expect(parseBody(addTaskLabel.mock.calls[0][1])).toEqual({ label_id: "l2" });
    expect(await screen.findByText("Urgent")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove label Backend" }));

    await waitFor(() => expect(removeTaskLabel).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove label Backend" })).not.toBeInTheDocument(),
    );
  });

  it("surfaces label attachment failures after creating a label", async () => {
    seedLoggedInSession();
    installDrawerApi({
      projectLabels: [],
      taskLabels: [],
      overrides: {
        "POST /workspaces/w1/projects/p1/labels": (_url, init) => ({
          ...label({ id: "l-created", name: String(parseBody(init).name) }),
        }),
        "POST /workspaces/w1/projects/p1/tasks/t1/labels": () =>
          new Response(JSON.stringify({ detail: "Label attach failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });

    renderDrawer();

    await userEvent.click(await screen.findByRole("button", { name: "New" }));
    const labelInput = screen.getByPlaceholderText("Label name");
    await userEvent.type(labelInput, "Review");
    await userEvent.click(within(labelInput.closest("form") as HTMLElement).getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Couldn't add label")).toBeInTheDocument();
    expect(screen.getByText("Label attach failed")).toBeInTheDocument();
  });

  it("creates subtasks and opens the created task", async () => {
    seedLoggedInSession();
    const onOpenTask = vi.fn();
    const { createTask } = installDrawerApi();

    renderDrawer(true, onOpenTask);

    expect(await screen.findByRole("button", { name: "Open subtask Existing subtask" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Subtask title"), "QA checklist");
    await userEvent.click(within(screen.getByText("Subtasks").parentElement as HTMLElement).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(parseBody(createTask.mock.calls[0][1])).toEqual({
      title: "QA checklist",
      parent_task_id: "t1",
    });
    expect(onOpenTask).toHaveBeenCalledWith("t-created");
  });

  it("adds dependencies while excluding self and existing blockers", async () => {
    seedLoggedInSession();
    const { addDependency } = installDrawerApi({
      dependencies: [{ blocking_task_id: "t3", blocked_task_id: "t1", created_at: NOW }],
    });

    renderDrawer();

    expect(await screen.findByRole("button", { name: "Open subtask Existing subtask" })).toBeInTheDocument();
    const select = screen.getByLabelText("Select blocking task");
    expect(within(select).queryByRole("option", { name: "Parent task" })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Existing subtask" })).not.toBeInTheDocument();

    await userEvent.selectOptions(select, "t2");
    await userEvent.click(within(screen.getByText("Blocked by").parentElement as HTMLElement).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addDependency).toHaveBeenCalledTimes(1));
    expect(parseBody(addDependency.mock.calls[0][1])).toEqual({ blocking_task_id: "t2" });
  });

  it("creates, edits, and deletes comments with moderator permissions", async () => {
    seedLoggedInSession();
    const { createComment, updateComment, deleteComment } = installDrawerApi();

    renderDrawer();

    await userEvent.type(await screen.findByPlaceholderText("Write a comment..."), "Fresh context");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    expect(parseBody(createComment.mock.calls[0][1])).toEqual({ body: "Fresh context" });
    expect(await screen.findByText("Fresh context")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Edit comment" })[1]);
    await userEvent.clear(screen.getByLabelText("Edit comment body"));
    await userEvent.type(screen.getByLabelText("Edit comment body"), "Moderated note");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateComment).toHaveBeenCalledTimes(1));
    expect(parseBody(updateComment.mock.calls[0][1])).toEqual({ body: "Moderated note" });
    expect(await screen.findByText("Moderated note")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Delete comment" })[1]);

    await waitFor(() => expect(deleteComment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Moderated note")).not.toBeInTheDocument());
  });

  it("hides advanced mutation controls from viewers", async () => {
    seedLoggedInSession();
    installDrawerApi();

    renderDrawer(false);

    expect(await screen.findByText("Backend")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add existing label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subtask title")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Select blocking task")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Write a comment...")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit comment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
  });
});
