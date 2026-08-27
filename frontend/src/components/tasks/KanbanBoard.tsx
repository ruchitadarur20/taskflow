import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { TaskCard } from "./TaskCard";
import { EmptyState } from "../ui/EmptyState";
import { LayoutGrid } from "lucide-react";
import { useUpdateTask } from "../../hooks/useTasks";
import { useToast } from "../../context/ToastContext";
import { TASK_STATUSES } from "../../api/projects";
import type { Task, TaskStatus } from "../../api/projects";
import type { WorkspaceMember } from "../../api/workspaces";

const COLUMN_TITLES: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
};

export function KanbanBoard({
  workspaceId,
  projectId,
  tasks,
  byUserId,
  onOpenTask,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  tasks: Task[];
  byUserId: Map<string, WorkspaceMember>;
  onOpenTask: (taskId: string) => void;
  canEdit: boolean;
}) {
  const updateTask = useUpdateTask(workspaceId, projectId);
  const { toast } = useToast();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = TASK_STATUSES.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
  }));

  function columnOf(id: string): TaskStatus | undefined {
    if ((TASK_STATUSES as string[]).includes(id)) return id as TaskStatus;
    return tasks.find((task) => task.id === id)?.status;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((task) => task.id === event.active.id) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const sourceStatus = columnOf(String(active.id));
    const destStatus = columnOf(String(over.id));
    if (!destStatus || sourceStatus === destStatus) return;
    updateTask.mutate(
      { taskId: String(active.id), input: { status: destStatus } },
      {
        onError: (error) => {
          toast({
            title: "Couldn't move task",
            description: error instanceof Error ? error.message : undefined,
            variant: "error",
          });
        },
      },
    );
  }

  if (!canEdit) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {columns.map((column) => (
          <div
            key={column.status}
            className="rounded-lg bg-muted/40 p-3"
            aria-label={`${COLUMN_TITLES[column.status]} column`}
          >
            <ColumnHeader status={column.status} count={column.tasks.length} />
            <div className="grid gap-2">
              {column.tasks.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No tasks
                </p>
              ) : null}
              {column.tasks.map((task) => (
                <TaskCardStatic
                  key={task.id}
                  task={task}
                  assignee={task.assignee_id ? byUserId.get(task.assignee_id) : undefined}
                  onClick={() => onOpenTask(task.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.status}
            status={column.status}
            tasks={column.tasks}
            byUserId={byUserId}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            assignee={activeTask.assignee_id ? byUserId.get(activeTask.assignee_id) : undefined}
            onClick={() => undefined}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ColumnHeader({ status, count }: { status: TaskStatus; count: number }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {COLUMN_TITLES[status]}
      </p>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  );
}

function KanbanColumn({
  status,
  tasks,
  byUserId,
  onOpenTask,
}: {
  status: TaskStatus;
  tasks: Task[];
  byUserId: Map<string, WorkspaceMember>;
  onOpenTask: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-40 flex-col rounded-lg p-3 transition-colors ${isOver ? "bg-primary/10" : "bg-muted/40"}`}
      aria-label={`${COLUMN_TITLES[status]} column`}
    >
      <ColumnHeader status={status} count={tasks.length} />
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-2">
          {tasks.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Drop tasks here
            </p>
          ) : null}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              assignee={task.assignee_id ? byUserId.get(task.assignee_id) : undefined}
              onClick={() => onOpenTask(task.id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function TaskCardStatic({
  task,
  assignee,
  onClick,
}: {
  task: Task;
  assignee?: WorkspaceMember;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open task ${task.title}`}
      className="rounded-lg border border-border bg-card p-3 text-left shadow-sm"
    >
      <p className="text-sm font-medium text-foreground">{task.title}</p>
    </button>
  );
}

export function EmptyBoard() {
  return <EmptyState icon={LayoutGrid} title="No tasks yet" description="Create your first task to see it here." />;
}
