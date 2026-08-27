import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderKanban, ListTodo, Search } from "lucide-react";

import { Overlay } from "../ui/Overlay";
import { useWorkspaceSearchIndex } from "../../hooks/useWorkspaceSearchIndex";
import { useDebounce } from "../../hooks/useDebounce";

export function SearchPalette({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 150);
  const navigate = useNavigate();
  const { projects, tasks, isLoading } = useWorkspaceSearchIndex(
    workspaceId,
    debouncedQuery.trim().length > 0,
  );

  const results = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    if (!needle) {
      return { projects: [], tasks: [] };
    }
    return {
      projects: projects.filter((project) => project.name.toLowerCase().includes(needle)).slice(0, 6),
      tasks: tasks.filter((task) => task.title.toLowerCase().includes(needle)).slice(0, 8),
    };
  }, [debouncedQuery, projects, tasks]);

  const hasQuery = debouncedQuery.trim().length > 0;
  const hasResults = results.projects.length > 0 || results.tasks.length > 0;

  return (
    <Overlay onClose={onClose} labelledBy="search-palette-title">
      <div className="m-auto mt-24 w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl">
        <h2 id="search-palette-title" className="sr-only">
          Search projects and tasks
        </h2>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects and tasks..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {!hasQuery ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Start typing to search this workspace.
            </p>
          ) : isLoading ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Searching...</p>
          ) : !hasResults ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matches for "{debouncedQuery}".
            </p>
          ) : (
            <>
              {results.projects.length > 0 ? (
                <div className="mb-2">
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Projects
                  </p>
                  {results.projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        navigate(`/w/${workspaceId}/projects/${project.id}`);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                    >
                      <FolderKanban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {project.name}
                    </button>
                  ))}
                </div>
              ) : null}

              {results.tasks.length > 0 ? (
                <div>
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tasks
                  </p>
                  {results.tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => {
                        navigate(`/w/${workspaceId}/projects/${task.project_id}?task=${task.id}`);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                    >
                      <ListTodo className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{task.title}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
