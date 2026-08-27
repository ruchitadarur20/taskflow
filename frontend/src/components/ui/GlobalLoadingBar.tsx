import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/**
 * A thin top-of-viewport progress bar that appears whenever any React Query
 * fetch or mutation is in flight - a single global loading indicator instead
 * of every page inventing its own.
 */
export function GlobalLoadingBar() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const active = isFetching > 0 || isMutating > 0;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
      role="progressbar"
      aria-hidden={!active}
      aria-valuetext={active ? "Loading" : undefined}
    >
      {active ? (
        <div className="h-full w-full origin-left animate-pulse bg-primary" />
      ) : null}
    </div>
  );
}
