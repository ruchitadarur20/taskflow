import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Avatar } from "../ui/Avatar";
import { DueDateLabel, PriorityBadge } from "./TaskBadges";
import type { Task } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

export function TaskCard({
  task,
  assignee,
  onClick,
}: {
  task: Task;
  assignee?: WorkspaceMember;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-lg border border-border bg-card p-3 shadow-sm ${isDragging ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open task ${task.title}`}
        {...attributes}
        {...listeners}
        className="w-full cursor-grab text-left active:cursor-grabbing"
      >
        <p className="text-sm font-medium text-foreground">{task.title}</p>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={task.priority} />
            <DueDateLabel dueAt={task.due_at} />
          </div>
          {assignee ? <Avatar name={assignee.user.display_name} size="sm" /> : null}
        </div>
      </button>
    </div>
  );
}
