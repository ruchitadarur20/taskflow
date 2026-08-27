import { Avatar } from "../ui/Avatar";
import { DueDateLabel, PriorityBadge, StatusBadge } from "./TaskBadges";
import type { Task } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

export function TaskRow({
  task,
  assignee,
  onClick,
  showStatus = true,
  projectName,
}: {
  task: Task;
  assignee?: WorkspaceMember;
  onClick: () => void;
  showStatus?: boolean;
  projectName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {projectName ? <span className="truncate">{projectName}</span> : null}
          <DueDateLabel dueAt={task.due_at} />
        </span>
      </span>
      {showStatus ? <StatusBadge status={task.status} /> : null}
      <PriorityBadge priority={task.priority} />
      {assignee ? (
        <Avatar name={assignee.user.display_name} size="sm" />
      ) : (
        <span className="h-6 w-6 rounded-full border border-dashed border-border" aria-hidden="true" />
      )}
    </button>
  );
}
