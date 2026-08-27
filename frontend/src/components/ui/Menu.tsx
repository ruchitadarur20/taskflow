import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../../lib/cn";

type MenuContextValue = {
  isOpen: boolean;
  close: () => void;
};

const MenuContext = createContext<MenuContextValue | null>(null);

/** A minimal, dependency-free dropdown menu: click-outside and Escape close it. */
export function Menu({
  trigger,
  children,
  align = "start",
  className,
}: {
  trigger: (props: { isOpen: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {trigger({ isOpen, toggle: () => setIsOpen((open) => !open) })}
      {isOpen ? (
        <MenuContext.Provider value={{ isOpen, close: () => setIsOpen(false) }}>
          <div
            role="menu"
            className={cn(
              "absolute z-40 mt-2 min-w-48 rounded-md border border-border bg-card p-1 shadow-lg",
              align === "end" ? "right-0" : "left-0",
              className,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  className,
  danger,
}: {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  danger?: boolean;
}) {
  const context = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClick?.();
        context?.close();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-muted",
        danger ? "text-danger" : "text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}
