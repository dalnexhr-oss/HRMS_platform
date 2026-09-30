'use client';

// Call showNotification() and render notificationContainer once per screen. Messages dismiss
// automatically or when clicked.
import { useCallback, useEffect, useState } from 'react';

type NotificationKind = 'info' | 'error' | 'success';

interface NotificationItem {
  id: number;
  message: string;
  kind: NotificationKind;
}

// Module-level counter for stable ids (avoids Date.now()/Math.random()).
let nextNotificationId = 0;

function NotificationMessage({
  notification,
  onDismiss,
}: {
  notification: NotificationItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const dismissTimer = setTimeout(onDismiss, 4500);
    return () => clearTimeout(dismissTimer);
  }, [onDismiss]);
  return (
    <div
      className={`notification-message${notification.kind !== 'info' ? ` ${notification.kind}` : ''}`}
      role="status"
      onClick={onDismiss}
    >
      {notification.message}
    </div>
  );
}

function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const dismissNotification = useCallback((notificationId: number) => {
    setNotifications((previousNotifications) =>
      previousNotifications.filter((notification) => notification.id !== notificationId),
    );
  }, []);

  const showNotification = useCallback((message: string, kind: NotificationKind = 'info') => {
    nextNotificationId += 1;
    const id = nextNotificationId;
    setNotifications((previousNotifications) => [...previousNotifications, { id, message, kind }]);
  }, []);

  const notificationContainer = (
    <div className="notification-container" aria-live="polite">
      {notifications.map((notification) => (
        <NotificationMessage
          key={notification.id}
          notification={notification}
          onDismiss={() => dismissNotification(notification.id)}
        />
      ))}
    </div>
  );

  return { showNotification, notificationContainer };
}

export { useNotifications, type NotificationKind };
