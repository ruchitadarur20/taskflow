import { ReactNode } from "react";
import { X } from "lucide-react";

import { Overlay } from "./Overlay";

export function Drawer({
  title,
  onClose,
  children,
  footer,
  titleId = "drawer-title",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  titleId?: string;
}) {
  return (
    <Overlay onClose={onClose} labelledBy={titleId}>
      <div className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t border-border px-5 py-3">{footer}</footer> : null}
      </div>
    </Overlay>
  );
}
