import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RequireAuth } from "./RequireAuth";
import { mockApi, renderWithProviders, seedLoggedInSession, TEST_TOKENS } from "../../test/utils";

function TestRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<p>Login page</p>} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <p>Protected content</p>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

describe("RequireAuth", () => {
  it("redirects to /login when there is no session", async () => {
    mockApi({});
    renderWithProviders(<TestRoutes />, { route: "/" });

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("renders the protected content once the session hydrates", async () => {
    seedLoggedInSession();
    mockApi({
      "GET /auth/me": () => TEST_TOKENS.user,
    });

    renderWithProviders(<TestRoutes />, { route: "/" });

    expect(await screen.findByText("Protected content")).toBeInTheDocument();
  });

  it("redirects to /login when the stored session fails to hydrate", async () => {
    seedLoggedInSession();
    mockApi({
      "GET /auth/me": () => {
        throw new Error("unused");
      },
    });
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;

    renderWithProviders(<TestRoutes />, { route: "/" });

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });
});
