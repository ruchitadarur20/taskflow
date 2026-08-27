import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Building2 } from "lucide-react";

import { useCreateWorkspace, useWorkspaces } from "../hooks/useWorkspaces";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SkeletonCard } from "../components/ui/Skeleton";
import { ErrorNotice } from "../components/data/QueryBoundary";

/** `/` has no meaning on its own - it hands off to the user's first workspace,
 * or a one-time "create your first workspace" screen if they have none. */
export function RootRedirect() {
  const workspacesQuery = useWorkspaces();

  if (workspacesQuery.isLoading) {
    return (
      <div className="mx-auto max-w-md p-8">
        <SkeletonCard />
      </div>
    );
  }

  if (workspacesQuery.isError) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorNotice
          message={
            workspacesQuery.error instanceof Error
              ? workspacesQuery.error.message
              : "Couldn't load your workspaces."
          }
        />
      </div>
    );
  }

  const first = workspacesQuery.data?.[0];
  if (first) {
    return <Navigate to={`/w/${first.id}`} replace />;
  }

  return <CreateFirstWorkspace />;
}

function CreateFirstWorkspace() {
  const [name, setName] = useState("");
  const createWorkspace = useCreateWorkspace();
  const { toast } = useToast();
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const workspace = await createWorkspace.mutateAsync(name.trim());
      setCreatedId(workspace.id);
    } catch (error) {
      toast({
        title: "Couldn't create workspace",
        description: error instanceof Error ? error.message : undefined,
        variant: "error",
      });
    }
  }

  if (createdId) {
    return <Navigate to={`/w/${createdId}`} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Building2 className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Create your first workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A workspace holds your team's projects, tasks, and members.
        </p>
        <form onSubmit={handleSubmit} className="mt-5 grid gap-3">
          <Input
            autoFocus
            placeholder="Acme Inc."
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
          />
          <Button type="submit" isLoading={createWorkspace.isPending} disabled={!name.trim()}>
            Create workspace
          </Button>
        </form>
      </div>
    </div>
  );
}
