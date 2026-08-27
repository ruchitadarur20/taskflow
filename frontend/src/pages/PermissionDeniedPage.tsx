import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

export function PermissionDeniedPage({
  message = "You don't have access to this workspace, project, or resource.",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-warning/10 p-4">
        <ShieldAlert className="h-8 w-8 text-warning" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-warning">403</p>
        <h1 className="mt-1 text-lg font-semibold text-foreground">Access denied</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      <Link
        to="/"
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
