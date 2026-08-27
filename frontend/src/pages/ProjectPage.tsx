import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";

import { useWorkspaceId, useProjectId } from "../hooks/useWorkspaceId";
import { useWorkspace, useWorkspaceMembers, useMemberLookup } from "../hooks/useWorkspaces";
import { useProject } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useActivity } from "../hooks/useTasks";
import { useProjectChannel } from "../hooks/useRealtimeSubscriptions";
import { useRealtimeEvent } from "../hooks/useRealtimeSubscriptions";
import { ProjectHeader } from "../components/projects/ProjectHeader";
import { KanbanBoard } from "../components/tasks/KanbanBoard";
import { TaskListView } from "../components/tasks/TaskListView";
import { TaskDetailDrawer } from "../components/tasks/TaskDetailDrawer";
import { CreateTaskDialog } from "../components/tasks/CreateTaskDialog";
import { ActivityEntry } from "../components/activity/ActivityEntry";
import { QueryBoundary } from "../components/data/QueryBoundary";
import { Button } from "../components/ui/Button";
import { SkeletonLines } from "../components/ui/Skeleton";
import { PermissionDeniedPage } from "./PermissionDeniedPage";
import { ApiError } from "../api/client";

type Tab = "board" | "list" | "activity";

export function ProjectPage() {
  const workspaceId = useWorkspaceId() as string;
  const projectId = useProjectId() as string;
  const [tab, setTab] = useState<Tab>("board");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const queryClient = useQueryClient();

  useProjectChannel(workspaceId, projectId);
  useRealtimeEvent(null, (event) => {
    if (event.project_id !== projectId) return;
    if (event.event_type.startsWith("project.")) {
      void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
    }
    if (event.event_type.startsWith("task.")) {
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
      if (event.task_id) {
        void queryClient.invalidateQueries({ queryKey: ["task", workspaceId, projectId, event.task_id] });
        void queryClient.invalidateQueries({
          queryKey: ["task-labels", workspaceId, projectId, event.task_id],
        });
      }
    }
    if (event.event_type === "comment.created" && event.task_id) {
      void queryClient.invalidateQueries({
        queryKey: ["task-comments", workspaceId, projectId, event.task_id],
      });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId, projectId] });
    }
  });

  const workspaceQuery = useWorkspace(workspaceId);
  const projectQuery = useProject(workspaceId, projectId);
  const tasksQuery = useTasks(workspaceId, projectId);
  const membersQuery = useWorkspaceMembers(workspaceId);
  const { byUserId } = useMemberLookup(workspaceId);

  if (projectQuery.isError) {
    const error = projectQuery.error;
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return <PermissionDeniedPage message="This project doesn't exist, or you don't have access to it." />;
    }
  }

  const canEdit = workspaceQuery.data ? workspaceQuery.data.current_user_role !== "viewer" : false;

  function openTask(taskId: string) {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set("task", taskId);
      return next;
    });
  }

  function closeTask() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.delete("task");
      return next;
    });
  }

  return (
    <QueryBoundary query={projectQuery} loading={<div className="p-6"><SkeletonLines count={6} /></div>}>
      {(project) => (
        <div>
          <ProjectHeader
            workspaceId={workspaceId}
            project={project}
            tasks={tasksQuery.data ?? []}
            members={membersQuery.data ?? []}
            canEdit={canEdit}
          />

          <div className="flex items-center justify-between border-b border-border px-4 sm:px-6 lg:px-8">
            <div className="flex gap-1" role="tablist" aria-label="Project views">
              <TabButton label="Board" active={tab === "board"} onClick={() => setTab("board")} />
              <TabButton label="List" active={tab === "list"} onClick={() => setTab("list")} />
              <TabButton label="Activity" active={tab === "activity"} onClick={() => setTab("activity")} />
            </div>
            {canEdit ? (
              <Button size="sm" onClick={() => setIsCreateOpen(true)} className="my-2">
                <Plus className="h-4 w-4" /> New task
              </Button>
            ) : null}
          </div>

          <div className="px-4 py-4 sm:px-6 lg:px-8">
            <QueryBoundary query={tasksQuery}>
              {(tasks) => (
                <>
                  {tab === "board" ? (
                    <KanbanBoard
                      workspaceId={workspaceId}
                      projectId={projectId}
                      tasks={tasks}
                      byUserId={byUserId}
                      onOpenTask={openTask}
                      canEdit={canEdit}
                    />
                  ) : null}
                  {tab === "list" ? (
                    <TaskListView tasks={tasks} byUserId={byUserId} onOpenTask={openTask} />
                  ) : null}
                  {tab === "activity" ? <ActivityTab workspaceId={workspaceId} projectId={projectId} /> : null}
                </>
              )}
            </QueryBoundary>
          </div>

          {openTaskId ? (
            <TaskDetailDrawer
              workspaceId={workspaceId}
              projectId={projectId}
              taskId={openTaskId}
              onClose={closeTask}
              onOpenTask={openTask}
              canEdit={canEdit}
            />
          ) : null}

          {isCreateOpen ? (
            <CreateTaskDialog
              workspaceId={workspaceId}
              projectId={projectId}
              onClose={() => setIsCreateOpen(false)}
              onCreated={(taskId) => {
                setIsCreateOpen(false);
                openTask(taskId);
              }}
            />
          ) : null}
        </div>
      )}
    </QueryBoundary>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-b-2 px-3 py-2.5 text-sm font-medium ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ActivityTab({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const activityQuery = useActivity(workspaceId, projectId);
  const { byUserId } = useMemberLookup(workspaceId);

  return (
    <QueryBoundary query={activityQuery}>
      {(events) =>
        events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ul className="max-w-2xl divide-y divide-border rounded-lg border border-border bg-card">
            {events.map((event) => (
              <li key={event.id} className="px-4 py-3">
                <ActivityEntry
                  event={event}
                  actorName={event.actor_id ? byUserId.get(event.actor_id)?.user.display_name : undefined}
                />
              </li>
            ))}
          </ul>
        )
      }
    </QueryBoundary>
  );
}
