import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  ChevronsUpDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Sun,
  SunMoon,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useCreateWorkspace, useWorkspaces } from "../../hooks/useWorkspaces";
import { useProjects, useCreateProject } from "../../hooks/useProjects";
import { useWorkspaceId } from "../../hooks/useWorkspaceId";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { SkeletonLines } from "../ui/Skeleton";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const workspaceId = useWorkspaceId();
  const workspacesQuery = useWorkspaces();
  const projectsQuery = useProjects(workspaceId);
  const currentWorkspace = workspacesQuery.data?.find((workspace) => workspace.id === workspaceId);

  return (
    <div className="flex h-full w-72 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-4 py-4">
        <WorkspaceSwitcher
          workspaces={workspacesQuery.data ?? []}
          current={currentWorkspace}
          isLoading={workspacesQuery.isLoading}
        />
        <button
          type="button"
          onClick={onNavigate}
          className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-white/5 md:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3" aria-label="Primary">
        {workspaceId ? (
          <NavLink
            to={`/w/${workspaceId}`}
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              `mb-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium ${
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-sidebar-foreground/80 hover:bg-white/5"
              }`
            }
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </NavLink>
        ) : null}

        <div className="mt-4 flex items-center justify-between px-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/50">
            Projects
          </p>
          {workspaceId ? <NewProjectButton workspaceId={workspaceId} /> : null}
        </div>

        <div className="mt-1 grid gap-0.5">
          {projectsQuery.isLoading ? (
            <div className="px-2.5 py-2">
              <SkeletonLines count={3} />
            </div>
          ) : null}
          {projectsQuery.data?.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-sidebar-foreground/50">No projects yet.</p>
          ) : null}
          {projectsQuery.data?.map((project) => (
            <NavLink
              key={project.id}
              to={`/w/${workspaceId}/projects/${project.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm ${
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-sidebar-foreground/80 hover:bg-white/5"
                }`
              }
            >
              <FolderKanban className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.name}</span>
            </NavLink>
          ))}
        </div>

        {workspaceId ? (
          <NavLink
            to={`/w/${workspaceId}/members`}
            onClick={onNavigate}
            className={({ isActive }) =>
              `mt-4 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm ${
                isActive
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-sidebar-foreground/80 hover:bg-white/5"
              }`
            }
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Members
          </NavLink>
        ) : null}
      </nav>

      <UserMenu />
    </div>
  );
}

function WorkspaceSwitcher({
  workspaces,
  current,
  isLoading,
}: {
  workspaces: { id: string; name: string; slug: string }[];
  current?: { id: string; name: string };
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <>
      <Menu
        className="min-w-64"
        trigger={({ toggle, isOpen }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              {current?.name?.[0]?.toUpperCase() ?? "T"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {isLoading ? "Loading..." : (current?.name ?? "Select workspace")}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" aria-hidden="true" />
          </button>
        )}
      >
        {workspaces.map((workspace) => (
          <MenuItem key={workspace.id} onClick={() => navigate(`/w/${workspace.id}`)}>
            {workspace.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New workspace
        </MenuItem>
      </Menu>

      {isCreateOpen ? <CreateWorkspaceDialog onClose={() => setIsCreateOpen(false)} /> : null}
    </>
  );
}

function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const createWorkspace = useCreateWorkspace();
  const navigate = useNavigate();
  const { toast } = useToast();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const workspace = await createWorkspace.mutateAsync(name.trim());
      toast({ title: "Workspace created", variant: "success" });
      onClose();
      navigate(`/w/${workspace.id}`);
    } catch (error) {
      toast({
        title: "Couldn't create workspace",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <Dialog title="Create workspace" onClose={onClose}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Input
          autoFocus
          placeholder="Acme Inc."
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={160}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={createWorkspace.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewProjectButton({ workspaceId }: { workspaceId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const createProject = useCreateProject(workspaceId);
  const navigate = useNavigate();
  const { toast } = useToast();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const project = await createProject.mutateAsync({ name: name.trim() });
      toast({ title: "Project created", variant: "success" });
      setIsOpen(false);
      setName("");
      navigate(`/w/${workspaceId}/projects/${project.id}`);
    } catch (error) {
      toast({
        title: "Couldn't create project",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="New project"
        className="rounded p-1 text-sidebar-foreground/60 hover:bg-white/5 hover:text-sidebar-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
      {isOpen ? (
        <Dialog title="New project" onClose={() => setIsOpen(false)}>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <Input
              autoFocus
              placeholder="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={createProject.isPending} disabled={!name.trim()}>
                Create
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();

  if (!user) return null;

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="border-t border-white/5 p-3">
      <Menu
        align="start"
        className="mb-1 w-64"
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-white/5"
          >
            <Avatar name={user.display_name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {user.display_name}
              </span>
              <span className="block truncate text-xs text-sidebar-foreground/50">
                {user.email}
              </span>
            </span>
          </button>
        )}
      >
        <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Theme
        </p>
        <MenuItem onClick={() => setPreference("light")}>
          <Sun className="h-4 w-4" /> Light {preference === "light" ? "✓" : ""}
        </MenuItem>
        <MenuItem onClick={() => setPreference("dark")}>
          <Moon className="h-4 w-4" /> Dark {preference === "dark" ? "✓" : ""}
        </MenuItem>
        <MenuItem onClick={() => setPreference("system")}>
          <SunMoon className="h-4 w-4" /> System {preference === "system" ? "✓" : ""}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onClick={handleLogout}>
          <LogOut className="h-4 w-4" /> Log out
        </MenuItem>
      </Menu>
    </div>
  );
}
