import { FormEvent, useState } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useCreateTask } from "../../hooks/useTasks";
import { useMemberLookup } from "../../hooks/useWorkspaces";
import { useToast } from "../../context/ToastContext";
import { TASK_PRIORITIES } from "../../api/projects";
import type { TaskPriority } from "../../api/projects";

export function CreateTaskDialog({
  workspaceId,
  projectId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  projectId: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}) {
  const createTask = useCreateTask(workspaceId, projectId);
  const { byUserId } = useMemberLookup(workspaceId);
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueAt, setDueAt] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      const task = await createTask.mutateAsync({
        title: title.trim(),
        assignee_id: assigneeId || null,
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onCreated(task.id);
    } catch (error) {
      toast({
        title: "Couldn't create task",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <Dialog title="New task" onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field label="Title" htmlFor="new-task-title">
          <Input
            id="new-task-title"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={240}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee" htmlFor="new-task-assignee">
            <Select
              id="new-task-assignee"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {Array.from(byUserId.values()).map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.user.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="new-task-priority">
            <Select
              id="new-task-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Due date" htmlFor="new-task-due">
          <Input
            id="new-task-due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={createTask.isPending} disabled={!title.trim()}>
            Create task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
