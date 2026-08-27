import { formatDistanceToNow } from "date-fns";
import { Bell, BellRing, Check } from "lucide-react";

import { Menu } from "../ui/Menu";
import { SkeletonLines } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { useMarkNotificationRead, useNotifications, useUnreadCount } from "../../hooks/useNotifications";
import { useRealtimeEvent } from "../../hooks/useRealtimeSubscriptions";
import { useQueryClient } from "@tanstack/react-query";
import type { Notification } from "../../api/notifications";

export function NotificationBell() {
  const notificationsQuery = useNotifications();
  const unreadCountQuery = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const queryClient = useQueryClient();

  useRealtimeEvent(["notification.created", "notification.read"], () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    void queryClient.invalidateQueries({ queryKey: ["unread-count"] });
  });

  const unreadCount = unreadCountQuery.data ?? 0;

  return (
    <Menu
      align="end"
      className="w-96 max-h-[28rem] overflow-y-auto p-0"
      trigger={({ toggle, isOpen }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Bell className="h-5 w-5" aria-hidden="true" />
          )}
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold text-foreground">Notifications</p>
        {unreadCount > 0 ? (
          <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
        ) : null}
      </div>

      {notificationsQuery.isLoading ? (
        <div className="p-4">
          <SkeletonLines count={4} />
        </div>
      ) : null}

      {notificationsQuery.data?.length === 0 ? (
        <div className="p-2">
          <EmptyState icon={Bell} title="You're all caught up" description="No notifications yet." />
        </div>
      ) : null}

      <ul>
        {notificationsQuery.data?.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onMarkRead={() => markRead.mutate(notification.id)}
          />
        ))}
      </ul>
    </Menu>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: () => void;
}) {
  const isUnread = notification.read_at === null;
  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onMarkRead}
        disabled={!isUnread}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted disabled:cursor-default"
      >
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isUnread ? "bg-primary" : "bg-transparent"}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${isUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {notification.title}
          </span>
          {notification.body ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {notification.body}
            </span>
          ) : null}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
          </span>
        </span>
        {isUnread ? (
          <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </button>
    </li>
  );
}
