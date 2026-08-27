import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  AuthUser,
  getCurrentUser,
  LoginInput,
  login as loginRequest,
  logout as logoutRequest,
  RegisterInput,
  refreshSession,
  register as registerRequest,
} from "../api/auth";
import {
  clearSession,
  isAccessTokenExpired,
  loadSession,
  saveSession,
  StoredSession,
} from "../lib/session";

type AuthContextValue = {
  session: StoredSession | null;
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Returns a currently-valid access token, refreshing first if it's about to expire. */
  getAccessToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

class SupersededRefreshError extends Error {
  constructor() {
    super("Authentication changed while refreshing");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionRef = useRef(session);
  const refreshPromiseRef = useRef<Promise<string> | null>(null);
  const authGenerationRef = useRef(0);
  sessionRef.current = session;

  const invalidateAuthentication = useCallback(() => {
    authGenerationRef.current += 1;
    clearSession();
    sessionRef.current = null;
    refreshPromiseRef.current = null;
    setSession(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    const current = sessionRef.current;
    if (!current) {
      throw new Error("Not authenticated");
    }
    if (!isAccessTokenExpired(current)) {
      return current.accessToken;
    }
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const refreshToken = current.refreshToken;
    const refreshGeneration = authGenerationRef.current;
    const refreshPromise = refreshSession(refreshToken)
      .then((refreshed) => {
        if (
          authGenerationRef.current !== refreshGeneration ||
          sessionRef.current?.refreshToken !== refreshToken
        ) {
          throw new SupersededRefreshError();
        }
        const nextSession = saveSession(refreshed);
        sessionRef.current = nextSession;
        setSession(nextSession);
        setUser(refreshed.user);
        return nextSession.accessToken;
      })
      .catch((error) => {
        if (!(error instanceof SupersededRefreshError)) {
          invalidateAuthentication();
        }
        throw error;
      })
      .finally(() => {
        if (refreshPromiseRef.current === refreshPromise) {
          refreshPromiseRef.current = null;
        }
      });

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [invalidateAuthentication]);

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      if (!sessionRef.current) {
        setIsLoading(false);
        return;
      }
      try {
        const token = await getAccessToken();
        const currentUser = await getCurrentUser(token);
        if (isMounted) {
          setUser(currentUser);
        }
      } catch (error) {
        if (!(error instanceof SupersededRefreshError)) {
          invalidateAuthentication();
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void hydrate();
    return () => {
      isMounted = false;
    };
    // Only ever runs once at mount - login()/register() set user directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidateAuthentication]);

  const login = useCallback(async (input: LoginInput) => {
    const tokens = await loginRequest(input);
    authGenerationRef.current += 1;
    queryClient.clear();
    const nextSession = saveSession(tokens);
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(tokens.user);
  }, [queryClient]);

  const register = useCallback(async (input: RegisterInput) => {
    const tokens = await registerRequest(input);
    authGenerationRef.current += 1;
    queryClient.clear();
    const nextSession = saveSession(tokens);
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(tokens.user);
  }, [queryClient]);

  const logout = useCallback(async () => {
    const current = sessionRef.current;
    authGenerationRef.current += 1;
    clearSession();
    sessionRef.current = null;
    refreshPromiseRef.current = null;
    setSession(null);
    setUser(null);
    queryClient.clear();
    if (current) {
      await logoutRequest(current.refreshToken);
    }
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{ session, user, isLoading, login, register, logout, getAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
