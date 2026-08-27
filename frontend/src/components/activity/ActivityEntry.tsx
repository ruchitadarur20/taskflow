import { formatDistanceToNow } from "date-fns";

import type { ActivityEvent } from "../../api/projects";

const VERB_BY_EVENT: Record<string, string> = {
  "project.created": "created this project",
  "project.updated": "updated the project",
  "project.archived": "archived the project",
  "task.created": "created a task",
  "task.updated": "updated a task",
  "task.status_changed": "changed a task's status",
  "task.assignee_changed": "changed a task's assignee",
  "task.due_date_changed": "changed a task's due date",
  "task.archived": "archived a task",
  "task.dependency_added": "added a task dependency",
  "task.label_added": "added a label",
  "task.label_removed": "removed a label",
  "task.comment_added": "commented on a task",
};

function describe(event: ActivityEvent): string {
  const verb = VERB_BY_EVENT[event.event_type] ?? event.event_type.replace(/[._]/g, " ");
  const change = event.metadata_json as Record<string, { old?: string; new?: string } | string>;

  if (event.event_type === "task.status_changed" && typeof change.status === "object") {
    return `moved a task from "${change.status.old}" to "${change.status.new}"`;
  }
  return verb;
}

export function ActivityEntry({ event, actorName }: { event: ActivityEvent; actorName?: string }) {
  return (
    <p className="text-sm text-foreground">
      <span className="font-medium">{actorName ?? "Someone"}</span> {describe(event)}
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
      </span>
    </p>
  );
}
