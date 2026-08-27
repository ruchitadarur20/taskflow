import { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import { SkeletonLines } from "../ui/Skeleton";

type QueryLike<T> = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
};

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Renders a React Query result's loading/error/success states consistently,
 * replacing the repeated `isLoading ? ... : isError ? ... : data ? ...`
 * ladder that used to live in every page.
 */
export function QueryBoundary<T>({
  query,
  loading,
  children,
}: {
  query: QueryLike<T>;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) {
    return <>{loading ?? <SkeletonLines count={4} />}</>;
  }
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : "Something went wrong.";
    return <ErrorNotice message={message} />;
  }
  if (query.data === undefined) {
    return null;
  }
  return <>{children(query.data)}</>;
}
