import { FormEvent, useEffect, useState } from "react";

import {
  Workspace,
  WorkspaceMember,
  createWorkspace,
  getWorkspaceMembers,
  listWorkspaces,
} from "../../api/workspaces";
import type { StoredSession } from "../auth/sessionStorage";

type WorkspaceShellProps = {
  session: StoredSession;
};

export function WorkspaceShell({ session }: WorkspaceShellProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setError(null);
      try {
        const loadedWorkspaces = await listWorkspaces(session);
        if (!isMounted) {
          return;
        }
        setWorkspaces(loadedWorkspaces);
        setSelectedWorkspaceId((current) => current || loadedWorkspaces[0]?.id || "");
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

    void load();
    return () => {
      isMounted = false;
    };
  }, [session]);

  useEffect(() => {
    let isMounted = true;

    async function loadMembers() {
      if (!selectedWorkspaceId) {
        setMembers([]);
        return;
      }
      try {
        const loadedMembers = await getWorkspaceMembers(session, selectedWorkspaceId);
        if (isMounted) {
          setMembers(loadedMembers);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load members");
        }
      }
    }

    void loadMembers();
    return () => {
      isMounted = false;
    };
  }, [selectedWorkspaceId, session]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    setError(null);
    try {
      const workspace = await createWorkspace(session, name);
      setWorkspaces((current) => [...current, workspace]);
      setSelectedWorkspaceId(workspace.id);
      setName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create workspace");
    }
  }

  return (
    <section className="workspace-shell">
      <div className="workspace-toolbar">
        <div>
          <p className="eyebrow">Workspaces</p>
          <h2>{selectedWorkspace?.name ?? "No workspace selected"}</h2>
        </div>
        <label className="selector-label">
          Workspace
          <select
            value={selectedWorkspaceId}
            onChange={(event) => setSelectedWorkspaceId(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form className="workspace-create" onSubmit={handleCreate}>
        <label>
          New workspace
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
        </label>
        <button type="submit">Create</button>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {isLoading ? <p className="muted">Loading workspaces...</p> : null}

      {selectedWorkspace ? (
        <div className="workspace-grid">
          <article className="workspace-card">
            <p className="muted">Current role</p>
            <strong>{selectedWorkspace.current_user_role}</strong>
            <p className="workspace-slug">{selectedWorkspace.slug}</p>
          </article>
          <article className="workspace-card">
            <p className="muted">Members</p>
            <ul className="member-list">
              {members.map((member) => (
                <li key={member.id}>
                  <span>
                    <strong>{member.user.display_name}</strong>
                    <small>{member.user.email}</small>
                  </span>
                  <span className="role-pill">{member.role}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      ) : (
        <p className="muted">Create a workspace to start the collaboration shell.</p>
      )}
    </section>
  );
}
