import { FormEvent, useEffect, useState } from "react";

import {
  AuthUser,
  getCurrentUser,
  login,
  logout,
  refreshSession,
  register,
} from "../../api/auth";
import {
  StoredSession,
  clearSession,
  isAccessTokenExpired,
  loadSession,
  saveSession,
} from "./sessionStorage";
import { ProjectTaskShell } from "../projects/ProjectTaskShell";
import { WorkspaceShell } from "../workspaces/WorkspaceShell";

type Mode = "login" | "register";

export function AuthShell() {
  const [mode, setMode] = useState<Mode>("login");
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(session));

  useEffect(() => {
    let isMounted = true;

    async function hydrateSession() {
      if (!session) {
        setIsLoading(false);
        return;
      }
      try {
        let activeSession = session;
        if (isAccessTokenExpired(activeSession)) {
          const refreshed = await refreshSession(activeSession.refreshToken);
          activeSession = saveSession(refreshed);
          if (isMounted) {
            setSession(activeSession);
          }
        }
        const currentUser = await getCurrentUser(activeSession.accessToken);
        if (isMounted) {
          setUser(currentUser);
        }
      } catch {
        clearSession();
        if (isMounted) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void hydrateSession();
    return () => {
      isMounted = false;
    };
  }, [session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const tokens =
        mode === "login"
          ? await login({ email, password })
          : await register({ email, password, display_name: displayName });
      const nextSession = saveSession(tokens);
      setSession(nextSession);
      setUser(tokens.user);
      setPassword("");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    if (session) {
      await logout(session.refreshToken).catch(() => undefined);
    }
    clearSession();
    setSession(null);
    setUser(null);
  }

  if (isLoading && !user) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="muted">Checking session...</p>
        </section>
      </main>
    );
  }

  if (user) {
    return (
      <main className="session-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">TaskFlow</p>
            <h1>Authenticated Session</h1>
          </div>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </header>
        <section className="session-panel">
          <p className="muted">Signed in as</p>
          <h2>{user.display_name}</h2>
          <p>{user.email}</p>
        </section>
        {session ? (
          <>
            <WorkspaceShell session={session} />
            <ProjectTaskShell session={session} />
          </>
        ) : null}
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-heading">
          <p className="eyebrow">TaskFlow</p>
          <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
        </div>

        <div className="mode-switch" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "register" ? (
            <label>
              Name
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              type="password"
              value={password}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}
