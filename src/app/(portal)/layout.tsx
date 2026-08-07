import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { getSession, isStaffRole } from '@/lib/auth';
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

  // Role gate — moved here from middleware, where it cost a profiles SELECT on
  // every single request. getSession() is request-memoized, so this is free.
  //
  // A missing profile row is fail-closed: never assume a role. A signed-in user
  // without one (trigger not run, deleted, unprovisioned) is sent to /login with
  // an explanation rather than into any area. This is the last line of defence
  // behind the 'employee' default from migration 0008.
  if (!profile) {
    redirect('/login?error=Your+account+is+not+provisioned+yet.+Ask+HR+to+set+up+your+access.');
  }
  if (!isStaffRole(profile.role)) redirect('/me');

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
