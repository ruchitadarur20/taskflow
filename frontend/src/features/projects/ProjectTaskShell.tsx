import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  Comment,
  Label,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  addTaskLabel,
  createComment,
  createLabel,
  createProject,
  createTask,
  listComments,
  listLabels,
  listProjects,
  listTaskLabels,
  listTasks,
  updateTask,
} from "../../api/projects";
import { Workspace, WorkspaceMember, getWorkspaceMembers, listWorkspaces } from "../../api/workspaces";
import type { StoredSession } from "../auth/sessionStorage";
import type { RealtimeClient } from "../../realtime/client";

type ProjectTaskShellProps = {
  session: StoredSession;
  client: RealtimeClient;
};

const statusOptions: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const priorityOptions: TaskPriority[] = ["low", "medium", "high", "urgent"];

export function ProjectTaskShell({ session, client }: ProjectTaskShellProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [taskLabels, setTaskLabels] = useState<Label[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#2f7d6d");
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const canWrite = selectedWorkspace?.current_user_role !== "viewer";

  const taskGroups = useMemo(
    () =>
      statusOptions.map((status) => ({
        status,
        tasks: tasks.filter((task) => task.status === status),
      })),
    [tasks],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspaces() {
      setError(null);
      try {
        const loadedWorkspaces = await listWorkspaces(session);
        if (!isMounted) {
          return;
        }
        setWorkspaces(loadedWorkspaces);
        setWorkspaceId((current) => current || loadedWorkspaces[0]?.id || "");
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load workspaces");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadWorkspaces();
    return () => {
      isMounted = false;
    };
  }, [session]);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspaceData() {
      if (!workspaceId) {
        setProjects([]);
        setMembers([]);
        return;
      }
      setError(null);
      try {
        const [loadedMembers, loadedProjects] = await Promise.all([
          getWorkspaceMembers(session, workspaceId),
          listProjects(session, workspaceId),
        ]);
        if (!isMounted) {
          return;
        }
        setMembers(loadedMembers);
        setProjects(loadedProjects);
        setProjectId((current) =>
          loadedProjects.some((project) => project.id === current)
            ? current
            : loadedProjects[0]?.id || "",
        );
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load projects");
        }
      }
    }

    void loadWorkspaceData();
    return () => {
      isMounted = false;
    };
  }, [workspaceId, session]);

  useEffect(() => {
    let isMounted = true;

    async function loadProjectData() {
      if (!workspaceId || !projectId) {
        setTasks([]);
        setLabels([]);
        setSelectedTaskId("");
        return;
      }
      setError(null);
      try {
        const [loadedTasks, loadedLabels] = await Promise.all([
          listTasks(session, workspaceId, projectId),
          listLabels(session, workspaceId, projectId),
        ]);
        if (!isMounted) {
          return;
        }
        setTasks(loadedTasks);
        setLabels(loadedLabels);
        setSelectedTaskId((current) =>
          loadedTasks.some((task) => task.id === current) ? current : loadedTasks[0]?.id || "",
        );
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load tasks");
        }
      }
    }

    void loadProjectData();
    return () => {
      isMounted = false;
    };
  }, [workspaceId, projectId, session]);

  useEffect(() => {
    let isMounted = true;

    async function loadTaskDetails() {
      if (!workspaceId || !projectId || !selectedTaskId) {
        setTaskLabels([]);
        setComments([]);
        return;
      }
      try {
        const [loadedTaskLabels, loadedComments] = await Promise.all([
          listTaskLabels(session, workspaceId, projectId, selectedTaskId),
          listComments(session, workspaceId, projectId, selectedTaskId),
        ]);
        if (isMounted) {
          setTaskLabels(loadedTaskLabels);
          setComments(loadedComments);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load task details");
        }
      }
    }

    void loadTaskDetails();
    return () => {
      isMounted = false;
    };
  }, [workspaceId, projectId, selectedTaskId, session]);

  // Realtime: stay subscribed to the selected workspace, and to the selected
  // project while one is open (re-subscribing whenever either changes).
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    client.subscribeWorkspace(workspaceId);
  }, [client, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !projectId) {
      return;
    }
    client.subscribeProject(workspaceId, projectId);
    return () => {
      client.unsubscribeProject(workspaceId, projectId);
    };
  }, [client, workspaceId, projectId]);

  // Realtime: react to server-pushed events by refetching the affected list
  // through the same REST endpoints used for the initial load, rather than
  // trying to hand-merge partial event payloads into local state.
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    const unsubscribe = client.onEvent((event) => {
      if (event.workspace_id !== workspaceId) {
        return;
      }

      if (event.event_type.startsWith("project.")) {
        void listProjects(session, workspaceId)
          .then(setProjects)
          .catch(() => undefined);
        return;
      }

      if (!projectId || event.project_id !== projectId) {
        return;
      }

      if (event.event_type.startsWith("task.")) {
        void listTasks(session, workspaceId, projectId)
          .then(setTasks)
          .catch(() => undefined);
        if (event.event_type === "task.label_added" || event.event_type === "task.label_removed") {
          void listLabels(session, workspaceId, projectId)
            .then(setLabels)
            .catch(() => undefined);
        }
      }

      if (selectedTaskId && event.task_id === selectedTaskId) {
        if (event.event_type === "comment.created") {
          void listComments(session, workspaceId, projectId, selectedTaskId)
            .then(setComments)
            .catch(() => undefined);
        }
        if (event.event_type === "task.label_added" || event.event_type === "task.label_removed") {
          void listTaskLabels(session, workspaceId, projectId, selectedTaskId)
            .then(setTaskLabels)
            .catch(() => undefined);
        }
      }
    });
    return unsubscribe;
  }, [client, session, workspaceId, projectId, selectedTaskId]);

  async function handleProjectCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !projectName.trim()) {
      return;
    }
    setError(null);
    try {
      const project = await createProject(session, workspaceId, {
        name: projectName,
        description: projectDescription || undefined,
      });
      setProjects((current) => [...current, project]);
      setProjectId(project.id);
      setProjectName("");
      setProjectDescription("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create project");
    }
  }

  async function handleTaskCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !projectId || !taskTitle.trim()) {
      return;
    }
    setError(null);
    try {
      const task = await createTask(session, workspaceId, projectId, {
        title: taskTitle,
        description: taskDescription || undefined,
        assignee_id: taskAssigneeId || null,
        due_at: taskDueAt ? new Date(taskDueAt).toISOString() : null,
        priority: taskPriority,
      });
      setTasks((current) => [...current, task]);
      setSelectedTaskId(task.id);
      setTaskTitle("");
      setTaskDescription("");
      setTaskAssigneeId("");
      setTaskDueAt("");
      setTaskPriority("medium");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create task");
    }
  }

  async function handleTaskPatch(task: Task, input: Parameters<typeof updateTask>[4]) {
    if (!workspaceId || !projectId) {
      return;
    }
    setError(null);
    try {
      const updatedTask = await updateTask(session, workspaceId, projectId, task.id, input);
      setTasks((current) =>
        current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update task");
    }
  }

  async function handleLabelCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !projectId || !labelName.trim()) {
      return;
    }
    setError(null);
    try {
      const label = await createLabel(session, workspaceId, projectId, {
        name: labelName,
        color: labelColor,
      });
      setLabels((current) => [...current, label]);
      setSelectedLabelId(label.id);
      setLabelName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create label");
    }
  }

  async function handleAttachLabel() {
    if (!workspaceId || !projectId || !selectedTaskId || !selectedLabelId) {
      return;
    }
    setError(null);
    try {
      const attachedLabels = await addTaskLabel(
        session,
        workspaceId,
        projectId,
        selectedTaskId,
        selectedLabelId,
      );
      setTaskLabels(attachedLabels);
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : "Unable to attach label");
    }
  }

  async function handleCommentCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !projectId || !selectedTaskId || !commentBody.trim()) {
      return;
    }
    setError(null);
    try {
      const comment = await createComment(session, workspaceId, projectId, selectedTaskId, commentBody);
      setComments((current) => [...current, comment]);
      setCommentBody("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create comment");
    }
  }

  return (
    <section className="project-shell">
      <div className="workspace-toolbar">
        <div>
          <p className="eyebrow">Projects and Tasks</p>
          <h2>{selectedProject?.name ?? "Project work area"}</h2>
        </div>
        <label className="selector-label">
          Workspace
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {isLoading ? <p className="muted">Loading project shell...</p> : null}

      {workspaceId ? (
        <div className="project-layout">
          <aside className="project-sidebar">
            <form onSubmit={handleProjectCreate}>
              <label>
                New project
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  maxLength={160}
                  disabled={!canWrite}
                />
              </label>
              <label>
                Description
                <input
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  maxLength={5000}
                  disabled={!canWrite}
                />
              </label>
              <button type="submit" disabled={!canWrite}>
                Create project
              </button>
            </form>

            <div className="project-list" aria-label="Project list">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={project.id === projectId ? "project-row active" : "project-row"}
                  onClick={() => setProjectId(project.id)}
                >
                  <span>{project.name}</span>
                  <small>{project.slug}</small>
                </button>
              ))}
            </div>
          </aside>

          <div className="task-main">
            <form className="task-create" onSubmit={handleTaskCreate}>
              <label>
                New task
                <input
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  maxLength={240}
                  disabled={!canWrite || !projectId}
                />
              </label>
              <label>
                Assignee
                <select
                  value={taskAssigneeId}
                  onChange={(event) => setTaskAssigneeId(event.target.value)}
                  disabled={!canWrite || !projectId}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.user.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due
                <input
                  type="datetime-local"
                  value={taskDueAt}
                  onChange={(event) => setTaskDueAt(event.target.value)}
                  disabled={!canWrite || !projectId}
                />
              </label>
              <label>
                Priority
                <select
                  value={taskPriority}
                  onChange={(event) => setTaskPriority(event.target.value as TaskPriority)}
                  disabled={!canWrite || !projectId}
                >
                  {priorityOptions.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-description">
                Notes
                <input
                  value={taskDescription}
                  onChange={(event) => setTaskDescription(event.target.value)}
                  maxLength={10000}
                  disabled={!canWrite || !projectId}
                />
              </label>
              <button type="submit" disabled={!canWrite || !projectId}>
                Add task
              </button>
            </form>

            <div className="task-board">
              {taskGroups.map((group) => (
                <section className="task-column" key={group.status}>
                  <h3>{group.status.replace("_", " ")}</h3>
                  {group.tasks.map((task) => (
                    <article
                      key={task.id}
                      className={task.id === selectedTaskId ? "task-card active" : "task-card"}
                    >
                      <button type="button" onClick={() => setSelectedTaskId(task.id)}>
                        {task.title}
                      </button>
                      <div className="task-meta">
                        <span>{task.priority}</span>
                        <span>
                          {task.assignee_id
                            ? members.find((member) => member.user_id === task.assignee_id)?.user
                                .display_name ?? "Assigned"
                            : "Unassigned"}
                        </span>
                      </div>
                      {canWrite ? (
                        <select
                          value={task.status}
                          onChange={(event) =>
                            handleTaskPatch(task, { status: event.target.value as TaskStatus })
                          }
                        >
                          {statusOptions.map((status) => (
                            <option key={status} value={status}>
                              {status.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </div>

          <aside className="task-inspector">
            {selectedTask ? (
              <>
                <p className="eyebrow">Task details</p>
                <h3>{selectedTask.title}</h3>
                <p className="muted">{selectedTask.description || "No notes yet."}</p>
                <div className="task-meta stacked">
                  <span>{selectedTask.status.replace("_", " ")}</span>
                  <span>{selectedTask.priority}</span>
                  <span>{selectedTask.due_at ? new Date(selectedTask.due_at).toLocaleString() : "No due date"}</span>
                </div>

                <form onSubmit={handleLabelCreate}>
                  <label>
                    Label
                    <input
                      value={labelName}
                      onChange={(event) => setLabelName(event.target.value)}
                      maxLength={80}
                      disabled={!canWrite}
                    />
                  </label>
                  <label>
                    Color
                    <input
                      type="color"
                      value={labelColor}
                      onChange={(event) => setLabelColor(event.target.value)}
                      disabled={!canWrite}
                    />
                  </label>
                  <button type="submit" disabled={!canWrite}>
                    Create label
                  </button>
                </form>

                <div className="label-row">
                  {taskLabels.map((label) => (
                    <span key={label.id} style={{ borderColor: label.color }}>
                      {label.name}
                    </span>
                  ))}
                </div>

                <div className="inline-controls">
                  <select
                    value={selectedLabelId}
                    onChange={(event) => setSelectedLabelId(event.target.value)}
                    disabled={!canWrite}
                  >
                    <option value="">Choose label</option>
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={handleAttachLabel} disabled={!canWrite || !selectedLabelId}>
                    Attach
                  </button>
                </div>

                <form onSubmit={handleCommentCreate}>
                  <label>
                    Comment
                    <input
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      maxLength={5000}
                      disabled={!canWrite}
                    />
                  </label>
                  <button type="submit" disabled={!canWrite}>
                    Post
                  </button>
                </form>

                <div className="comment-list">
                  {comments.map((comment) => (
                    <p key={comment.id}>{comment.body}</p>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Select a task to inspect labels and comments.</p>
            )}
          </aside>
        </div>
      ) : (
        <p className="muted">Create or join a workspace before adding projects.</p>
      )}
    </section>
  );
}
