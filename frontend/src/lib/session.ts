import type { AuthTokens } from "../api/auth";

const ACCESS_TOKEN_KEY = "taskflow.accessToken";
const REFRESH_TOKEN_KEY = "taskflow.refreshToken";
const ACCESS_EXPIRES_KEY = "taskflow.accessExpiresAt";

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
};

export function saveSession(tokens: AuthTokens): StoredSession {
  const session = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: tokens.access_token_expires_at,
  };
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
  localStorage.setItem(ACCESS_EXPIRES_KEY, session.accessTokenExpiresAt);
  return session;
}

export function loadSession(): StoredSession | null {
  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const accessTokenExpiresAt = localStorage.getItem(ACCESS_EXPIRES_KEY);
  if (!accessToken || !refreshToken || !accessTokenExpiresAt) {
    return null;
  }
  return { accessToken, refreshToken, accessTokenExpiresAt };
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ACCESS_EXPIRES_KEY);
}

export function isAccessTokenExpired(session: StoredSession): boolean {
  return Date.parse(session.accessTokenExpiresAt) <= Date.now() + 30_000;
}
