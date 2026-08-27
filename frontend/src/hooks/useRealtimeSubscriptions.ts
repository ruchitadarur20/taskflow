import { useEffect, useRef } from "react";

import { useRealtime } from "../context/RealtimeContext";
import type { RealtimeEvent, RealtimeEventType } from "../realtime/client";

export function useWorkspaceChannel(workspaceId: string | undefined): void {
  const { client } = useRealtime();
  useEffect(() => {
    if (!client || !workspaceId) {
      return;
    }
    client.subscribeWorkspace(workspaceId);
    return () => client.unsubscribeWorkspace(workspaceId);
  }, [client, workspaceId]);
}

export function useProjectChannel(
  workspaceId: string | undefined,
  projectId: string | undefined,
): void {
  const { client } = useRealtime();
  useEffect(() => {
    if (!client || !workspaceId || !projectId) {
      return;
    }
    client.subscribeProject(workspaceId, projectId);
    return () => client.unsubscribeProject(workspaceId, projectId);
  }, [client, workspaceId, projectId]);
}

/**
 * Fires `handler` for every deduplicated realtime event, optionally filtered
 * to a set of event types. `handler` is read from a ref so callers don't need
 * to memoize it themselves.
 */
export function useRealtimeEvent(
  types: RealtimeEventType[] | null,
  handler: (event: RealtimeEvent) => void,
): void {
  const { client } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.onEvent((event) => {
      if (types && !types.includes(event.event_type)) {
        return;
      }
      handlerRef.current(event);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, types?.join(",")]);
}
