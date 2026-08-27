import { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { RealtimeProvider } from "../context/RealtimeContext";
import { ToastProvider } from "../context/ToastContext";
import type { AuthTokens } from "../api/auth";

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", queryClient = makeTestQueryClient() }: { route?: string; queryClient?: QueryClient } = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <ThemeProvider>
              <RealtimeProvider>
                <ToastProvider>{children}</ToastProvider>
              </RealtimeProvider>
            </ThemeProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

export const TEST_TOKENS: AuthTokens = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  token_type: "bearer",
  access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    email: "owner@example.com",
    display_name: "Owner Person",
    created_at: new Date().toISOString(),
  },
};

export function seedLoggedInSession(): void {
  localStorage.setItem("taskflow.accessToken", TEST_TOKENS.access_token);
  localStorage.setItem("taskflow.refreshToken", TEST_TOKENS.refresh_token);
  localStorage.setItem("taskflow.accessExpiresAt", TEST_TOKENS.access_token_expires_at);
}

type RouteHandler = (url: URL, init?: RequestInit) => unknown | Promise<unknown>;

/**
 * Installs a global fetch mock routed by `${method} ${pathname}`. Falls back
 * to 404 for anything unregistered, so an unexpected request fails loudly
 * with a clear message instead of hanging.
 */
export function mockApi(routes: Record<string, RouteHandler>): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ detail: `Unhandled request: ${key}` }), { status: 404 });
    }
    const body = await handler(url, init);
    if (body instanceof Response) {
      return body;
    }
    if (body === undefined) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
