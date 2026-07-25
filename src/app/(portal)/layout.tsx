import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { getSession } from '@/lib/auth';
import {
  getMyNotifications,
  getUnreadNotificationCount,
  getTopbarStats,
} from '@/lib/queries';

// The portal shell (sidebar + sticky topbar) wraps every screen. Each route
// under (portal) renders inside <main>, replacing the prototype's tab switch.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [{ profile, email }, notifications, unread, stats] = await Promise.all([
    getSession(),
    getMyNotifications(),
    getUnreadNotificationCount(),
    getTopbarStats(),
  ]);
  return (
    <div className="shell">
      <Sidebar name={profile?.full_name} role={profile?.role} />
      <main className="main">
        <Topbar
          name={profile?.full_name}
          avatar={profile?.avatar ?? null}
          role={profile?.role ?? null}
          email={email}
          notifications={notifications}
          unread={unread}
          stats={stats}
        />
        <section className="screen">{children}</section>
      </main>
    </div>
  );
}
