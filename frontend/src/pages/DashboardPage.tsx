import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CheckCircle2,
  FolderKanban,
  ListChecks,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useWorkspaceId } from "../hooks/useWorkspaceId";
import { useProjects } from "../hooks/useProjects";
import { useMemberLookup, useWorkspace } from "../hooks/useWorkspaces";
import { useNotifications } from "../hooks/useNotifications";
import {
  bucketTasksByDueDate,
  useMyTasksAcrossWorkspace,
  useRecentActivityAcrossWorkspace,
} from "../hooks/useDashboardData";
import { useRealtimeEvent, useWorkspaceChannel } from "../hooks/useRealtimeSubscriptions";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonCard, SkeletonLines } from "../components/ui/Skeleton";
import { TaskRow } from "../components/tasks/TaskRow";
import { ActivityEntry } from "../components/activity/ActivityEntry";
import { ErrorNotice, QueryBoundary } from "../components/data/QueryBoundary";
import { ApiError } from "../api/client";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function DashboardPage() {
  const workspaceId = useWorkspaceId();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useWorkspaceChannel(workspaceId);
  useRealtimeEvent(null, (event) => {
    if (!workspaceId || event.workspace_id !== workspaceId) {
      return;
    }
    if (event.event_type.startsWith("project.")) {
      void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-my-tasks", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-activity", workspaceId] });
    }
    if (event.event_type.startsWith("task.") || event.event_type.startsWith("comment.")) {
      void queryClient.invalidateQueries({ queryKey: ["dashboard-my-tasks", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-activity", workspaceId] });
    }
    if (event.event_type.startsWith("notification.")) {
      void queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["unread-count", workspaceId] });
    }
  });

  const workspaceQuery = useWorkspace(workspaceId);
  const projectsQuery = useProjects(workspaceId);
  const {
    tasks: myTasks,
    isLoading: tasksLoading,
    isError: tasksError,
    error: tasksErrorValue,
    failedProjectCount: failedTaskProjectCount,
  } = useMyTasksAcrossWorkspace(workspaceId, user?.id);
  const {
    activity,
    isLoading: activityLoading,
    isError: activityError,
    error: activityErrorValue,
    failedProjectCount: failedActivityProjectCount,
  } = useRecentActivityAcrossWorkspace(workspaceId);
  const notificationsQuery = useNotifications(workspaceId);
  const { byUserId } = useMemberLookup(workspaceId);
  const buckets = bucketTasksByDueDate(myTasks);
  const projectsById = new Map((projectsQuery.data ?? []).map((project) => [project.id, project]));

  if (workspaceQuery.isError) {
    const error = workspaceQuery.error;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return (
        <PermissionDeniedPage message="This workspace doesn't exist, or you don't have access to it." />
      );
    }
  }

  function openTask(task: { project_id: string; id: string }) {
    navigate(`/w/${workspaceId}/projects/${task.project_id}?task=${task.id}`);
  }

  const doneCount = myTasks.filter((task) => task.status === "done").length;

  return (
    <QueryBoundary query={workspaceQuery}>
      {() => (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">
        Welcome back{user ? `, ${user.display_name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Here's what's happening in your workspace.</p>
      {failedTaskProjectCount > 0 ? (
        <div className="mt-4">
          <ErrorNotice message={`${failedTaskProjectCount} project task list could not be loaded.`} />
        </div>
      ) : null}
      {failedActivityProjectCount > 0 ? (
        <div className="mt-4">
          <ErrorNotice message={`${failedActivityProjectCount} project activity feed could not be loaded.`} />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={ListChecks} label="Assigned to me" value={myTasks.length} isLoading={tasksLoading} />
        <StatCard
          icon={AlarmClock}
          label="Overdue"
          value={buckets.overdue.length}
          isLoading={tasksLoading}
          tone={buckets.overdue.length > 0 ? "danger" : "default"}
        />
        <StatCard icon={CalendarClock} label="Due this week" value={buckets.dueSoon.length} isLoading={tasksLoading} />
        <StatCard icon={CheckCircle2} label="Completed" value={doneCount} isLoading={tasksLoading} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Recent projects</h2>
            {projectsQuery.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : projectsQuery.data?.length === 0 ? (
              <EmptyState icon={FolderKanban} title="No projects yet" description="Create one from the sidebar to get started." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projectsQuery.data?.slice(0, 4).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => navigate(`/w/${workspaceId}/projects/${project.id}`)}
                    className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary/40 hover:shadow-sm"
                  >
                    <p className="font-medium text-foreground">{project.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {project.description || "No description"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Overdue</h2>
            <TaskGroup
              tasks={buckets.overdue}
              isLoading={tasksLoading}
              isError={tasksError}
              error={tasksErrorValue}
              emptyLabel="Nothing overdue. Nice work."
              onOpen={openTask}
              byUserId={byUserId}
              projectsById={projectsById}
            />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Upcoming</h2>
            <TaskGroup
              tasks={[...buckets.dueSoon, ...buckets.upcoming].slice(0, 8)}
              isLoading={tasksLoading}
              isError={tasksError}
              error={tasksErrorValue}
              emptyLabel="No upcoming tasks assigned to you."
              onOpen={openTask}
              byUserId={byUserId}
              projectsById={projectsById}
            />
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Bell className="h-4 w-4" aria-hidden="true" /> Notifications
            </h2>
            <div className="rounded-lg border border-border bg-card">
              {notificationsQuery.isLoading ? (
                <div className="p-3">
                  <SkeletonLines count={3} />
                </div>
              ) : notificationsQuery.data?.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No notifications yet.</p>
              ) : (
                <ul>
                  {notificationsQuery.data?.slice(0, 5).map((notification) => (
                    <li key={notification.id} className="border-b border-border px-3 py-2.5 last:border-0">
                      <p className="text-sm text-foreground">{notification.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(notification.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Activity feed</h2>
            <div className="rounded-lg border border-border bg-card">
              {activityLoading ? (
                <div className="p-3">
                  <SkeletonLines count={4} />
                </div>
              ) : activityError ? (
                <div className="p-3">
                  <ErrorNotice
                    message={
                      activityErrorValue instanceof Error
                        ? activityErrorValue.message
                        : "Activity could not be loaded."
                    }
                  />
                </div>
              ) : activity.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((event) => (
                    <li key={event.id} className="px-3 py-2.5">
                      <ActivityEntry
                        event={event}
                        actorName={
                          event.actor_id ? byUserId.get(event.actor_id)?.user.display_name : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
      )}
    </QueryBoundary>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  isLoading,
  tone = "default",
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  isLoading: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      role="group"
      aria-label={`${label}: ${isLoading ? "loading" : value}`}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${tone === "danger" && value > 0 ? "text-danger" : "text-foreground"}`}>
        {isLoading ? <span className="inline-block h-7 w-8 animate-pulse rounded bg-muted align-middle" /> : value}
      </p>
    </div>
  );
}

function TaskGroup({
  tasks,
  isLoading,
  isError,
  error,
  emptyLabel,
  onOpen,
  byUserId,
  projectsById,
}: {
  tasks: ReturnType<typeof bucketTasksByDueDate>["overdue"];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  emptyLabel: string;
  onOpen: (task: { project_id: string; id: string }) => void;
  byUserId: ReturnType<typeof useMemberLookup>["byUserId"];
  projectsById: Map<string, { name: string }>;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <SkeletonLines count={3} />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorNotice
        message={error instanceof Error ? error.message : "Tasks could not be loaded."}
      />
    );
  }
  if (tasks.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="rounded-lg border border-border bg-card">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          assignee={task.assignee_id ? byUserId.get(task.assignee_id) : undefined}
          onClick={() => onOpen(task)}
          projectName={projectsById.get(task.project_id)?.name}
        />
      ))}
    </div>
  );
}
