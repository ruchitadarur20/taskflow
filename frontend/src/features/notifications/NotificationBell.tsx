import { useEffect, useState } from "react";

import {
  Notification,
  getUnreadCount,
  listNotifications,
  markNotificationRead,
} from "../../api/notifications";
import type { StoredSession } from "../auth/sessionStorage";
import type { ConnectionStatus, RealtimeClient } from "../../realtime/client";

type NotificationBellProps = {
  session: StoredSession;
  client: RealtimeClient;
};

export function NotificationBell({ session, client }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const [loadedNotifications, count] = await Promise.all([
          listNotifications(session),
          getUnreadCount(session),
        ]);
        if (isMounted) {
          setNotifications(loadedNotifications);
          setUnreadCount(count);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load notifications");
        }
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, [session]);

  useEffect(() => {
    const unsubscribeStatus = client.onStatusChange(setStatus);
    const unsubscribeEvents = client.onEvent((event) => {
      if (event.event_type === "notification.created") {
        setUnreadCount((current) => current + 1);
        void listNotifications(session)
          .then(setNotifications)
          .catch(() => undefined);
      }
    });
    return () => {
      unsubscribeStatus();
      unsubscribeEvents();
    };
  }, [client, session]);

  async function handleMarkRead(notification: Notification) {
    if (notification.read_at) {
      return;
    }
    try {
      const updated = await markNotificationRead(session, notification.id);
      setNotifications((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Unable to mark notification read");
    }
  }

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="notification-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Notifications"
      >
        <span className={`connection-dot connection-${status}`} title={`Realtime: ${status}`} />
        Notifications
        {unreadCount > 0 ? <span className="badge">{unreadCount}</span> : null}
      </button>

      {isOpen ? (
        <div className="notification-panel">
          {error ? <p className="error">{error}</p> : null}
          {notifications.length === 0 ? <p className="muted">No notifications yet.</p> : null}
          <ul className="notification-list">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={notification.read_at ? "notification-item read" : "notification-item"}
              >
                <button type="button" onClick={() => handleMarkRead(notification)}>
                  <strong>{notification.title}</strong>
                  {notification.body ? <span>{notification.body}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
