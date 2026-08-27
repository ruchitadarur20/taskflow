import { AlertTriangle, ArrowDown, ArrowUp, CircleDot, Equal } from "lucide-react";

import { Badge, type BadgeTone } from "../ui/Badge";
import type { TaskPriority, TaskStatus } from "../../api/projects";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
};

const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  todo: "muted",
  in_progress: "primary",
  blocked: "danger",
  done: "success",
  archived: "muted",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_ICON: Record<TaskPriority, typeof ArrowUp> = {
  low: ArrowDown,
  medium: Equal,
  high: ArrowUp,
  urgent: AlertTriangle,
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  low: "text-muted-foreground",
  medium: "text-primary",
  high: "text-warning",
  urgent: "text-danger",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${PRIORITY_CLASSES[priority]}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function DueDateLabel({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) {
    return <span className="text-xs text-muted-foreground">No due date</span>;
  }
  const date = new Date(dueAt);
  const isOverdue = date.getTime() < Date.now();
  return (
    <span className={`text-xs ${isOverdue ? "font-medium text-danger" : "text-muted-foreground"}`}>
      {isOverdue ? <CircleDot className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}
      {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}
