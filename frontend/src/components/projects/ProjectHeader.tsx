import { FormEvent, useState } from "react";
import { CheckCircle2, ListTodo, Pencil, Users } from "lucide-react";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Textarea } from "../ui/Input";
import { useUpdateProject } from "../../hooks/useProjects";
import { useToast } from "../../context/ToastContext";
import type { Project, Task } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

export function ProjectHeader({
  workspaceId,
  project,
  tasks,
  members,
  canEdit,
}: {
  workspaceId: string;
  project: Project;
  tasks: Task[];
  members: WorkspaceMember[];
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter(
    (task) => task.due_at && new Date(task.due_at).getTime() < Date.now() && task.status !== "done",
  ).length;

  return (
    <div className="border-b border-border px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-foreground">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {project.description || "No description yet."}
          </p>
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-5">
        <Stat icon={ListTodo} label={`${total} tasks`} />
        <Stat icon={CheckCircle2} label={`${done} done`} />
        {overdue > 0 ? <Stat icon={ListTodo} label={`${overdue} overdue`} tone="danger" /> : null}
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="flex -space-x-1.5">
            {members.slice(0, 6).map((member) => (
              <Avatar
                key={member.id}
                name={member.user.display_name}
                size="sm"
                className="ring-2 ring-background"
              />
            ))}
          </div>
          {members.length > 6 ? (
            <span className="text-xs text-muted-foreground">+{members.length - 6}</span>
          ) : null}
        </div>
      </div>

      {isEditing ? (
        <EditProjectDialog
          workspaceId={workspaceId}
          project={project}
          onClose={() => setIsEditing(false)}
        />
      ) : null}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  tone = "default",
}: {
  icon: typeof ListTodo;
  label: string;
  tone?: "default" | "danger";
}) {
  return (
    <span
      className={`flex items-center gap-1.5 text-sm ${tone === "danger" ? "text-danger" : "text-muted-foreground"}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  );
}

function EditProjectDialog({
  workspaceId,
  project,
  onClose,
}: {
  workspaceId: string;
  project: Project;
  onClose: () => void;
}) {
  const updateProject = useUpdateProject(workspaceId, project.id);
  const { toast } = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await updateProject.mutateAsync({ name: name.trim(), description });
      toast({ title: "Project updated", variant: "success" });
      onClose();
    } catch (error) {
      toast({
        title: "Couldn't update project",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <Dialog title="Edit project" onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field label="Name" htmlFor="edit-project-name">
          <Input
            id="edit-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
          />
        </Field>
        <Field label="Description" htmlFor="edit-project-description">
          <Textarea
            id="edit-project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={updateProject.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
