import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Avatar } from "../ui/Avatar";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { EmptyState } from "../ui/EmptyState";
import { ListTodo } from "lucide-react";
import { DueDateLabel, PriorityBadge, StatusBadge } from "./TaskBadges";
import { TASK_STATUSES } from "../../api/projects";
import type { Task, TaskStatus } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

type SortKey = "title" | "status" | "priority" | "due_at";
const PRIORITY_RANK: Record<Task["priority"], number> = { low: 0, medium: 1, high: 2, urgent: 3 };

export function TaskListView({
  tasks,
  byUserId,
  onOpenTask,
}: {
  tasks: Task[];
  byUserId: Map<string, WorkspaceMember>;
  onOpenTask: (taskId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due_at");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);

  const members = Array.from(byUserId.values());

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (needle && !task.title.toLowerCase().includes(needle)) return false;
      if (statusFilter && task.status !== statusFilter) return false;
      if (assigneeFilter && task.assignee_id !== assigneeFilter) return false;
      return true;
    });
  }, [tasks, search, statusFilter, assigneeFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let result = 0;
      if (sortKey === "title") result = a.title.localeCompare(b.title);
      else if (sortKey === "status") result = a.status.localeCompare(b.status);
      else if (sortKey === "priority") result = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      else if (sortKey === "due_at") {
        result = (a.due_at ? new Date(a.due_at).getTime() : Infinity) -
          (b.due_at ? new Date(b.due_at).getTime() : Infinity);
      }
      return result * sortDirection;
    });
    return copy;
  }, [filtered, sortKey, sortDirection]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDirection(1);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by title..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-56"
        />
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "")}
          className="max-w-40"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace("_", " ")}
            </option>
          ))}
        </Select>
        <Select
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          className="max-w-48"
          aria-label="Filter by assignee"
        >
          <option value="">All assignees</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.user.display_name}
            </option>
          ))}
        </Select>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon={ListTodo} title="No matching tasks" description="Try adjusting your filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <SortableHeader label="Title" sortKey="title" active={sortKey} direction={sortDirection} onSort={toggleSort} />
                <SortableHeader label="Status" sortKey="status" active={sortKey} direction={sortDirection} onSort={toggleSort} />
                <SortableHeader label="Priority" sortKey="priority" active={sortKey} direction={sortDirection} onSort={toggleSort} />
                <SortableHeader label="Due" sortKey="due_at" active={sortKey} direction={sortDirection} onSort={toggleSort} />
                <th className="px-3 py-2">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((task) => {
                const assignee = task.assignee_id ? byUserId.get(task.assignee_id) : undefined;
                return (
                  <tr
                    key={task.id}
                    onClick={() => onOpenTask(task.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-3 py-2.5 font-medium text-foreground">{task.title}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td className="px-3 py-2.5">
                      <DueDateLabel dueAt={task.due_at} />
                    </td>
                    <td className="px-3 py-2.5">
                      {assignee ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar name={assignee.user.display_name} size="xs" />
                          <span className="truncate text-xs text-muted-foreground">
                            {assignee.user.display_name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unassigned</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: 1 | -1;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  const Icon = isActive ? (direction === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </button>
    </th>
  );
}
