import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import * as notificationsApi from "../api/notifications";

export function useNotifications(workspaceId?: string) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["notifications", workspaceId],
    queryFn: async () => notificationsApi.listNotifications(await getAccessToken(), { workspaceId }),
  });
}

export function useUnreadCount(workspaceId?: string) {
  const { getAccessToken } = useAuth();
  return useQuery({
    queryKey: ["unread-count", workspaceId],
    queryFn: async () => notificationsApi.getUnreadCount(await getAccessToken(), workspaceId),
  });
}

export function useMarkNotificationRead() {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) =>
      notificationsApi.markNotificationRead(await getAccessToken(), notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });
}
