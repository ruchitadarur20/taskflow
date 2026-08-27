import { createContext, ReactNode, useContext, useEffect, useState } from "react";

import { useAuth } from "./AuthContext";
import { ConnectionStatus, RealtimeClient } from "../realtime/client";

type RealtimeContextValue = {
  client: RealtimeClient | null;
  status: ConnectionStatus;
};

const RealtimeContext = createContext<RealtimeContextValue>({ client: null, status: "disconnected" });

/**
 * Owns the single RealtimeClient for the whole app, keyed to the session's
 * access token: a fresh client connects whenever the token changes (login,
 * logout, refresh-rotation) and the previous one is disconnected. The client
 * itself (reconnect/backoff/resubscribe/dedupe) is unchanged from Milestone 6
 * - this only wires its lifecycle and connection status into React.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    if (!session) {
      setClient(null);
      setStatus("disconnected");
      return;
    }
    const nextClient = new RealtimeClient(session.accessToken);
    const unsubscribe = nextClient.onStatusChange(setStatus);
    nextClient.connect();
    setClient(nextClient);
    return () => {
      unsubscribe();
      nextClient.disconnect();
    };
  }, [session?.accessToken]);

  return (
    <RealtimeContext.Provider value={{ client, status }}>{children}</RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
