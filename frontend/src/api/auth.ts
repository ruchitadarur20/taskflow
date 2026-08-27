import { apiRequest } from "./client";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
};

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  access_token_expires_at: string;
  user: AuthUser;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = LoginInput & {
  display_name: string;
};

export function login(input: LoginInput): Promise<AuthTokens> {
  return apiRequest<AuthTokens>("/auth/login", { method: "POST", body: input });
}

export function register(input: RegisterInput): Promise<AuthTokens> {
  return apiRequest<AuthTokens>("/auth/register", { method: "POST", body: input });
}

export function refreshSession(refreshToken: string): Promise<AuthTokens> {
  return apiRequest<AuthTokens>("/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

export function logout(refreshToken: string): Promise<void> {
  return apiRequest<void>("/auth/logout", {
    method: "POST",
    body: { refresh_token: refreshToken },
  }).catch(() => undefined);
}

export function getCurrentUser(token: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("/auth/me", { token });
}
