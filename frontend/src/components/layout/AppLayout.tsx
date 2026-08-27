import { useState } from "react";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Overlay } from "../ui/Overlay";

export function AppLayout() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {isMobileNavOpen ? (
        <Overlay onClose={() => setIsMobileNavOpen(false)} labelledBy="mobile-nav-title">
          <h2 id="mobile-nav-title" className="sr-only">
            Navigation
          </h2>
          <div className="mr-auto h-full">
            <Sidebar onNavigate={() => setIsMobileNavOpen(false)} />
          </div>
        </Overlay>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setIsMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
