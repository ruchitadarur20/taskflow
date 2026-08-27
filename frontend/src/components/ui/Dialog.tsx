import { ReactNode } from "react";

import { Overlay } from "./Overlay";

export function Dialog({
  title,
  description,
  onClose,
  children,
  titleId = "dialog-title",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  titleId?: string;
}) {
  return (
    <Overlay onClose={onClose} labelledBy={titleId}>
      <div className="m-auto w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </Overlay>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  onConfirm,
  onClose,
  isLoading,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onClose: () => void;
  isLoading?: boolean;
}) {
  return (
    <Dialog title={title} description={description} onClose={onClose}>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md px-3 text-sm font-medium text-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className={
            tone === "danger"
              ? "h-9 rounded-md bg-danger px-3 text-sm font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
              : "h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          }
        >
          {isLoading ? "Working..." : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
