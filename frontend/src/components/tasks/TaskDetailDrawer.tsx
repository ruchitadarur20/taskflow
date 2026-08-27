import { FormEvent, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { GitBranch, Link2, Pencil, Plus, Trash2, X } from "lucide-react";

import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { Avatar } from "../ui/Avatar";
import { Badge, ColorDot } from "../ui/Badge";
import { SkeletonLines } from "../ui/Skeleton";
import { ErrorNotice } from "../data/QueryBoundary";
import { ActivityEntry } from "../activity/ActivityEntry";
import { useMemberLookup } from "../../hooks/useWorkspaces";
import { useCreateLabel, useLabels } from "../../hooks/useProjects";
import {
  useActivity,
  useAddDependency,
  useAddTaskLabel,
  useCreateTask,
  useComments,
  useCreateComment,
  useDeleteComment,
  useDependencies,
  useRemoveTaskLabel,
  useTask,
  useTaskLabels,
  useTasks,
  useUpdateComment,
  useUpdateTask,
} from "../../hooks/useTasks";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../api/projects";
import type { TaskCoreUpdateInput, TaskPriority, TaskStatus } from "../../api/projects";

export function TaskDetailDrawer({
  workspaceId,
  projectId,
  taskId,
  onClose,
  onOpenTask,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
  canEdit: boolean;
}) {
  const taskQuery = useTask(workspaceId, projectId, taskId);
  const updateTask = useUpdateTask(workspaceId, projectId);
  const { byUserId } = useMemberLookup(workspaceId);
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (taskQuery.data) {
      setTitle(taskQuery.data.title);
      setDescription(taskQuery.data.description ?? "");
    }
  }, [taskQuery.data?.id]);

  if (taskQuery.isLoading) {
    return (
      <Drawer title="Loading task..." onClose={onClose}>
        <SkeletonLines count={6} />
      </Drawer>
    );
  }

  if (taskQuery.isError || !taskQuery.data) {
    return (
      <Drawer title="Task" onClose={onClose}>
        <ErrorNotice
          message={taskQuery.error instanceof Error ? taskQuery.error.message : "Task not found."}
        />
      </Drawer>
    );
  }

  const task = taskQuery.data;
  const members = Array.from(byUserId.values());

  function commitField<K extends "status" | "priority" | "assignee_id" | "due_at">(
    field: K,
    value: NonNullable<TaskCoreUpdateInput[K]> | "",
  ) {
    updateTask.mutate(
      { taskId, input: { [field]: value === "" ? null : value } as Pick<TaskCoreUpdateInput, K> },
      {
        onError: (error) => {
          toast({
            title: "Update failed",
            description: error instanceof Error ? error.message : undefined,
            variant: "error",
          });
        },
      },
    );
  }

  function commitTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) return;
    updateTask.mutate({ taskId, input: { title: trimmed } });
  }

  function commitDescription() {
    if (description === (task.description ?? "")) return;
    updateTask.mutate({ taskId, input: { description } });
  }

  return (
    <Drawer title={canEdit ? "Edit task" : "Task"} onClose={onClose} titleId="task-drawer-title">
      <div className="grid gap-5">
        <div>
          {canEdit ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              className="border-none px-0 text-lg font-semibold shadow-none focus-visible:border-none"
              aria-label="Task title"
            />
          ) : (
            <h3 className="text-lg font-semibold text-foreground">{task.title}</h3>
          )}
          {canEdit ? (
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={commitDescription}
              placeholder="Add a description..."
              className="mt-2"
              aria-label="Task description"
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{task.description || "No description."}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Status">
            <Select
              aria-label="Task status"
              value={task.status}
              disabled={!canEdit}
              onChange={(event) => commitField("status", event.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((status: TaskStatus) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </Select>
          </FieldBlock>
          <FieldBlock label="Priority">
            <Select
              aria-label="Task priority"
              value={task.priority}
              disabled={!canEdit}
              onChange={(event) => commitField("priority", event.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((priority: TaskPriority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </Select>
          </FieldBlock>
          <FieldBlock label="Assignee">
            <Select
              aria-label="Task assignee"
              value={task.assignee_id ?? ""}
              disabled={!canEdit}
              onChange={(event) => commitField("assignee_id", event.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.user.display_name}
                </option>
              ))}
            </Select>
          </FieldBlock>
          <FieldBlock label="Due date">
            <Input
              aria-label="Task due date"
              type="datetime-local"
              disabled={!canEdit}
              value={task.due_at ? toLocalInputValue(task.due_at) : ""}
              onChange={(event) =>
                commitField(
                  "due_at",
                  event.target.value ? new Date(event.target.value).toISOString() : "",
                )
              }
            />
          </FieldBlock>
        </div>

        <TaskLabelsSection
          workspaceId={workspaceId}
          projectId={projectId}
          taskId={taskId}
          canEdit={canEdit}
        />

        <SubtasksSection
          workspaceId={workspaceId}
          projectId={projectId}
          taskId={taskId}
          canEdit={canEdit}
          onOpenTask={onOpenTask}
        />

        <DependenciesSection
          workspaceId={workspaceId}
          projectId={projectId}
          taskId={taskId}
          canEdit={canEdit}
        />

        <CommentsSection workspaceId={workspaceId} projectId={projectId} taskId={taskId} canEdit={canEdit} />

        <ActivitySection workspaceId={workspaceId} projectId={projectId} taskId={taskId} />
      </div>
    </Drawer>
  );
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-sm font-semibold text-foreground">{children}</h4>;
}

function TaskLabelsSection({
  workspaceId,
  projectId,
  taskId,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canEdit: boolean;
}) {
  const taskLabelsQuery = useTaskLabels(workspaceId, projectId, taskId);
  const labelsQuery = useLabels(workspaceId, projectId);
  const addLabel = useAddTaskLabel(workspaceId, projectId, taskId);
  const removeLabel = useRemoveTaskLabel(workspaceId, projectId, taskId);
  const createLabel = useCreateLabel(workspaceId, projectId);
  const { toast } = useToast();
  const [pendingLabelId, setPendingLabelId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#2f7d6d");

  const attachedIds = new Set((taskLabelsQuery.data ?? []).map((label) => label.id));
  const available = (labelsQuery.data ?? []).filter((label) => !attachedIds.has(label.id));

  async function handleCreateLabel(event: FormEvent) {
    event.preventDefault();
    if (!newLabelName.trim()) return;
    try {
      const label = await createLabel.mutateAsync({ name: newLabelName.trim(), color: newLabelColor });
      await addLabel.mutateAsync(label.id);
      setNewLabelName("");
      setIsCreating(false);
    } catch (error) {
      toast({
        title: "Couldn't add label",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  async function handleAddLabel(labelId: string) {
    setPendingLabelId(labelId);
    if (!labelId) return;
    try {
      await addLabel.mutateAsync(labelId);
      setPendingLabelId("");
    } catch (error) {
      toast({
        title: "Couldn't add label",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
      setPendingLabelId("");
    }
  }

  function handleRemoveLabel(labelId: string) {
    removeLabel.mutate(labelId, {
      onError: (error) => {
        toast({
          title: "Couldn't remove label",
          description: error instanceof Error ? error.message : undefined,
          variant: "error",
        });
      },
    });
  }

  return (
    <div>
      <SectionHeading>Labels</SectionHeading>
      {taskLabelsQuery.isLoading || labelsQuery.isLoading ? <SkeletonLines count={1} /> : null}
      {taskLabelsQuery.isError || labelsQuery.isError ? (
        <ErrorNotice message="Labels could not be loaded." />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {(taskLabelsQuery.data ?? []).map((label) => (
          <Badge key={label.id} className="gap-1.5">
            <ColorDot color={label.color} />
            {label.name}
            {canEdit ? (
              <button
                type="button"
                onClick={() => handleRemoveLabel(label.id)}
                aria-label={`Remove label ${label.name}`}
                className="ml-0.5 text-muted-foreground hover:text-danger"
              >
                ×
              </button>
            ) : null}
          </Badge>
        ))}
        {canEdit ? (
          <>
            {available.length > 0 ? (
              <Select
                value={pendingLabelId}
                onChange={(event) => void handleAddLabel(event.target.value)}
                disabled={addLabel.isPending}
                className="h-7 w-auto max-w-32 text-xs"
                aria-label="Add existing label"
              >
                <option value="">+ Add label</option>
                {available.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <button
              type="button"
              onClick={() => setIsCreating((open) => !open)}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Plus className="mr-0.5 inline h-3 w-3" /> New
            </button>
          </>
        ) : null}
      </div>
      {isCreating ? (
        <form onSubmit={handleCreateLabel} className="mt-2 flex items-center gap-2">
          <Input
            autoFocus
            value={newLabelName}
            onChange={(event) => setNewLabelName(event.target.value)}
            placeholder="Label name"
            maxLength={80}
            className="h-8 max-w-40 text-sm"
          />
          <input
            type="color"
            value={newLabelColor}
            onChange={(event) => setNewLabelColor(event.target.value)}
            className="h-8 w-8 rounded border border-input"
            aria-label="Label color"
          />
          <Button type="submit" size="sm" disabled={!newLabelName.trim()} isLoading={createLabel.isPending || addLabel.isPending}>
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function SubtasksSection({
  workspaceId,
  projectId,
  taskId,
  canEdit,
  onOpenTask,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canEdit: boolean;
  onOpenTask?: (taskId: string) => void;
}) {
  const tasksQuery = useTasks(workspaceId, projectId);
  const createTask = useCreateTask(workspaceId, projectId);
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const subtasks = (tasksQuery.data ?? []).filter((task) => task.parent_task_id === taskId);

  async function handleCreateSubtask(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const created = await createTask.mutateAsync({ title: trimmed, parent_task_id: taskId });
      setTitle("");
      onOpenTask?.(created.id);
    } catch (error) {
      toast({
        title: "Couldn't create subtask",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div>
      <SectionHeading>Subtasks</SectionHeading>
      {tasksQuery.isLoading ? <SkeletonLines count={2} /> : null}
      {tasksQuery.isError ? <ErrorNotice message="Subtasks could not be loaded." /> : null}
      {subtasks.length === 0 && !tasksQuery.isLoading && !tasksQuery.isError ? (
        <p className="text-sm text-muted-foreground">No subtasks yet.</p>
      ) : null}
      {subtasks.length > 0 ? (
        <ul className="grid gap-1.5">
          {subtasks.map((subtask) => (
            <li key={subtask.id}>
              <button
                type="button"
                onClick={() => onOpenTask?.(subtask.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                aria-label={`Open subtask ${subtask.title}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{subtask.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {subtask.status.replace("_", " ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <form onSubmit={handleCreateSubtask} className="mt-2 flex items-center gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Subtask title"
            maxLength={200}
            className="h-8 text-sm"
            aria-label="Subtask title"
          />
          <Button type="submit" size="sm" disabled={!title.trim()} isLoading={createTask.isPending}>
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function DependenciesSection({
  workspaceId,
  projectId,
  taskId,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canEdit: boolean;
}) {
  const dependenciesQuery = useDependencies(workspaceId, projectId, taskId);
  const tasksQuery = useTasks(workspaceId, projectId);
  const addDependency = useAddDependency(workspaceId, projectId, taskId);
  const { toast } = useToast();
  const [selected, setSelected] = useState("");

  const candidates = (tasksQuery.data ?? []).filter(
    (task) =>
      task.id !== taskId && !(dependenciesQuery.data ?? []).some((dep) => dep.blocking_task_id === task.id),
  );
  const titleFor = (id: string) => tasksQuery.data?.find((task) => task.id === id)?.title ?? id;

  async function handleAdd() {
    if (!selected) return;
    try {
      await addDependency.mutateAsync(selected);
      setSelected("");
    } catch (error) {
      toast({
        title: "Couldn't add dependency",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <div>
      <SectionHeading>Blocked by</SectionHeading>
      {(dependenciesQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Not blocked by any task.</p>
      ) : (
        <ul className="grid gap-1.5">
          {dependenciesQuery.data?.map((dependency) => (
            <li
              key={dependency.blocking_task_id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
            >
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {titleFor(dependency.blocking_task_id)}
            </li>
          ))}
        </ul>
      )}
      {canEdit && candidates.length > 0 ? (
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="max-w-56"
            aria-label="Select blocking task"
          >
            <option value="">Select a task...</option>
            {candidates.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={!selected}>
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CommentsSection({
  workspaceId,
  projectId,
  taskId,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canEdit: boolean;
}) {
  const commentsQuery = useComments(workspaceId, projectId, taskId);
  const createComment = useCreateComment(workspaceId, projectId, taskId);
  const updateComment = useUpdateComment(workspaceId, projectId, taskId);
  const deleteComment = useDeleteComment(workspaceId, projectId, taskId);
  const { byUserId } = useMemberLookup(workspaceId);
  const { user } = useAuth();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const currentUserRole = user ? byUserId.get(user.id)?.role : undefined;
  const canModerateComments = currentUserRole === "owner" || currentUserRole === "admin";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      await createComment.mutateAsync(body.trim());
      setBody("");
    } catch (error) {
      toast({
        title: "Couldn't add comment",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  function startEditing(commentId: string, commentBody: string) {
    setEditingCommentId(commentId);
    setEditingBody(commentBody);
  }

  async function handleUpdate(event: FormEvent, commentId: string) {
    event.preventDefault();
    const trimmed = editingBody.trim();
    if (!trimmed) return;
    try {
      await updateComment.mutateAsync({ commentId, body: trimmed });
      setEditingCommentId(null);
      setEditingBody("");
    } catch (error) {
      toast({
        title: "Couldn't update comment",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  function handleDelete(commentId: string) {
    deleteComment.mutate(commentId, {
      onError: (error) => {
        toast({
          title: "Couldn't delete comment",
          description: error instanceof Error ? error.message : undefined,
          variant: "error",
        });
      },
    });
  }

  return (
    <div>
      <SectionHeading>Comments</SectionHeading>
      <div className="grid gap-3">
        {commentsQuery.isLoading ? <SkeletonLines count={2} /> : null}
        {commentsQuery.isError ? <ErrorNotice message="Comments could not be loaded." /> : null}
        {commentsQuery.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : null}
        {commentsQuery.data?.map((comment) => {
          const author = byUserId.get(comment.author_id);
          const name = author?.user.display_name ?? (comment.author_id === user?.id ? user.display_name : "Member");
          const canModifyComment = canEdit && (comment.author_id === user?.id || canModerateComments);
          const isEditing = editingCommentId === comment.id;
          return (
            <div key={comment.id} className="flex gap-2.5">
              <Avatar name={name} size="sm" />
              <div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">{name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                    </p>
                    {canModifyComment && !isEditing ? (
                      <button
                        type="button"
                        onClick={() => startEditing(comment.id, comment.body)}
                        aria-label="Edit comment"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {canModifyComment ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        aria-label="Delete comment"
                        className="text-muted-foreground hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
                {isEditing ? (
                  <form onSubmit={(event) => void handleUpdate(event, comment.id)} className="mt-2 grid gap-2">
                    <Textarea
                      value={editingBody}
                      onChange={(event) => setEditingBody(event.target.value)}
                      maxLength={5000}
                      aria-label="Edit comment body"
                      className="min-h-16"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!editingBody.trim()}
                        isLoading={updateComment.isPending}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingCommentId(null)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {canEdit ? (
        <form onSubmit={handleSubmit} className="mt-3 flex items-start gap-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a comment..."
            className="min-h-10"
            maxLength={5000}
          />
          <Button type="submit" size="sm" disabled={!body.trim()} isLoading={createComment.isPending}>
            Post
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function ActivitySection({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
}) {
  const activityQuery = useActivity(workspaceId, projectId, taskId);
  const { byUserId } = useMemberLookup(workspaceId);

  return (
    <div>
      <SectionHeading>Activity</SectionHeading>
      {activityQuery.isLoading ? <SkeletonLines count={2} /> : null}
      {activityQuery.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : null}
      <ul className="grid gap-2">
        {activityQuery.data?.map((event) => (
          <li key={event.id}>
            <ActivityEntry
              event={event}
              actorName={event.actor_id ? byUserId.get(event.actor_id)?.user.display_name : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
