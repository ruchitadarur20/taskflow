import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Menu as MenuIcon, Search, Wifi, WifiOff } from "lucide-react";

import { useWorkspace } from "../../hooks/useWorkspaces";
import { useProject } from "../../hooks/useProjects";
import { useWorkspaceId, useProjectId } from "../../hooks/useWorkspaceId";
import { useRealtime } from "../../context/RealtimeContext";
import { NotificationBell } from "../notifications/NotificationBell";
import { SearchPalette } from "../search/SearchPalette";

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const workspaceId = useWorkspaceId();
  const projectId = useProjectId();
  const workspaceQuery = useWorkspace(workspaceId);
  const projectQuery = useProject(workspaceId, projectId);
  const { status } = useRealtime();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="shrink-0 text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              TaskFlow
            </Link>
          </li>
          {workspaceId ? (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <li className="min-w-0 shrink-0">
                <Link to={`/w/${workspaceId}`} className="truncate font-medium text-foreground hover:underline">
                  {workspaceQuery.data?.name ?? "..."}
                </Link>
              </li>
            </>
          ) : null}
          {projectId ? (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <li className="min-w-0 truncate font-medium text-foreground" aria-current="page">
                {projectQuery.data?.name ?? "..."}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <span
        className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"
        title={`Realtime: ${status}`}
      >
        {status === "connected" ? (
          <Wifi className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
        )}
      </span>

      {workspaceId ? (
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted sm:flex"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
          <kbd className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>
      ) : null}
      {workspaceId ? (
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          aria-label="Search"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted sm:hidden"
        >
          <Search className="h-5 w-5" />
        </button>
      ) : null}

      <NotificationBell />

      {isSearchOpen && workspaceId ? (
        <SearchPalette workspaceId={workspaceId} onClose={() => setIsSearchOpen(false)} />
      ) : null}
    </header>
  );
}
