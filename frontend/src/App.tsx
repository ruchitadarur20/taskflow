import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { ToastProvider } from "./context/ToastContext";
import { ErrorBoundary } from "./components/errors/ErrorBoundary";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AppLayout } from "./components/layout/AppLayout";
import { GlobalLoadingBar } from "./components/ui/GlobalLoadingBar";
import { queryClient } from "./lib/queryClient";

import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { RootRedirect } from "./pages/RootRedirect";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectPage } from "./pages/ProjectPage";
import { MembersPage } from "./pages/MembersPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <RealtimeProvider>
              <ToastProvider>
                <BrowserRouter>
                  <GlobalLoadingBar />
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route
                      element={
                        <RequireAuth>
                          <AppLayout />
                        </RequireAuth>
                      }
                    >
                      <Route path="/" element={<RootRedirect />} />
                      <Route path="/w/:workspaceId" element={<DashboardPage />} />
                      <Route path="/w/:workspaceId/members" element={<MembersPage />} />
                      <Route path="/w/:workspaceId/projects/:projectId" element={<ProjectPage />} />
                    </Route>
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </BrowserRouter>
              </ToastProvider>
            </RealtimeProvider>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
