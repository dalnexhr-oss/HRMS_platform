import 'server-only';
import { scoped, NotSignedInError } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { isoOrNull, iso } from '@/lib/queries/shared';

// notifications
interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Read the caller's notifications through recipient-scoped policies. Absorb only missing-session
 * errors so layouts can finish their login redirect; propagate other failures.
 */
async function getMyNotifications(limit = 20): Promise<NotificationRow[]> {
  try {
    const notifications = await scoped(collections.notifications);
    const rows = await notifications.find({}, { sort: { created_at: -1 }, limit });
    return rows.map((n) => ({
      id: n._id as string,
      kind: n.kind as string,
      title: n.title as string,
      body: (n.body as string | null) ?? null,
      link: (n.link as string | null) ?? null,
      readAt: isoOrNull(n.read_at),
      createdAt: iso(n.created_at),
    }));
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return [];
    }
    throw error;
  }
}

/** Unread count for the topbar badge. Absorbs a missing session only — see above. */
async function getUnreadNotificationCount(): Promise<number> {
  try {
    const notifications = await scoped(collections.notifications);
    return await notifications.countDocuments({ read_at: null });
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return 0;
    }
    throw error;
  }
}

export { getMyNotifications, getUnreadNotificationCount };

export type { NotificationRow };
