import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LoginPage } from "./LoginPage";
import { mockApi, renderWithProviders, TEST_TOKENS } from "../test/utils";

describe("LoginPage", () => {
  it("logs in and persists the session", async () => {
    mockApi({
      "POST /auth/login": () => TEST_TOKENS,
    });

    renderWithProviders(<LoginPage />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "StrongPass123!");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(localStorage.getItem("taskflow.accessToken")).toBe(TEST_TOKENS.access_token);
    });
  });

  it("shows an error message when login fails", async () => {
    mockApi({
      "POST /auth/login": () => {
        throw new Error("unused");
      },
    });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "Invalid email or password" }), { status: 401 })) as typeof fetch;

    renderWithProviders(<LoginPage />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  it("disables submit while sign-in is pending", async () => {
    let resolveLogin: (tokens: typeof TEST_TOKENS) => void = () => undefined;
    mockApi({
      "POST /auth/login": () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    });

    renderWithProviders(<LoginPage />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "StrongPass123!");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

    resolveLogin(TEST_TOKENS);
    await waitFor(() => {
      expect(localStorage.getItem("taskflow.accessToken")).toBe(TEST_TOKENS.access_token);
    });
  });
});
