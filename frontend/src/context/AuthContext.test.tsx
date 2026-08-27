import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./AuthContext";
import { makeTestQueryClient, mockApi, TEST_TOKENS } from "../test/utils";

function TokenConsumer() {
  const { getAccessToken } = useAuth();
  const [token, setToken] = useState("");

  useEffect(() => {
    void Promise.all([getAccessToken(), getAccessToken()]).then(([first]) => setToken(first));
  }, [getAccessToken]);

  return <p>{token || "Waiting"}</p>;
}

function RefreshLogoutRaceConsumer() {
  const { getAccessToken, logout } = useAuth();
  const [result, setResult] = useState("Waiting");

  useEffect(() => {
    void getAccessToken()
      .then((token) => setResult(token))
      .catch(() => setResult("Refresh rejected"));
  }, [getAccessToken]);

  return (
    <>
      <p>{result}</p>
      <button type="button" onClick={() => void logout()}>
        Log out now
      </button>
    </>
  );
}

describe("AuthContext", () => {
  it("shares one refresh request across concurrent token consumers", async () => {
    const refreshedTokens = {
      ...TEST_TOKENS,
      access_token: "rotated-access-token",
      refresh_token: "rotated-refresh-token",
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    localStorage.setItem("taskflow.accessToken", "expired-access-token");
    localStorage.setItem("taskflow.refreshToken", "old-refresh-token");
    localStorage.setItem("taskflow.accessExpiresAt", new Date(Date.now() - 1000).toISOString());

    const refresh = vi.fn(async () => refreshedTokens);
    mockApi({
      "POST /auth/refresh": refresh,
      "GET /auth/me": () => refreshedTokens.user,
    });

    render(
      <QueryClientProvider client={makeTestQueryClient()}>
        <AuthProvider>
          <TokenConsumer />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("rotated-access-token")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("taskflow.refreshToken")).toBe("rotated-refresh-token");
  });

  it("does not restore a rotated session when refresh resolves after logout", async () => {
    const refreshedTokens = {
      ...TEST_TOKENS,
      access_token: "late-access-token",
      refresh_token: "late-refresh-token",
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    localStorage.setItem("taskflow.accessToken", "expired-access-token");
    localStorage.setItem("taskflow.refreshToken", "old-refresh-token");
    localStorage.setItem("taskflow.accessExpiresAt", new Date(Date.now() - 1000).toISOString());

    let resolveRefresh: (tokens: typeof refreshedTokens) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<typeof refreshedTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    mockApi({
      "POST /auth/refresh": refresh,
      "POST /auth/logout": () => undefined,
      "GET /auth/me": () => refreshedTokens.user,
    });

    render(
      <QueryClientProvider client={makeTestQueryClient()}>
        <AuthProvider>
          <RefreshLogoutRaceConsumer />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Log out now" }));

    resolveRefresh(refreshedTokens);

    expect(await screen.findByText("Refresh rejected")).toBeInTheDocument();
    expect(localStorage.getItem("taskflow.accessToken")).toBeNull();
    expect(localStorage.getItem("taskflow.refreshToken")).toBeNull();
  });
});
