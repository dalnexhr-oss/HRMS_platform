import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Route } from 'next';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { getSession, isStaffRole } from '@/lib/auth';
import { canAccessTab, slugFromPathname } from '@/lib/access';
import { NAV } from '@/lib/constants';
import {
  getMyNotifications,
  getUnreadNotificationCount,
  getTopbarStats,
  getMyTabAccess,
} from '@/lib/queries';

// The portal shell (sidebar + sticky topbar) wraps every screen. Each route
// under (portal) renders inside <main>, replacing the prototype's tab switch.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [{ profile, email }, notifications, unread, stats, hdrs] = await Promise.all([
    getSession(),
    getMyNotifications(),
    getUnreadNotificationCount(),
    getTopbarStats(),
    headers(),
  ]);

  // Needs the profile id, so it cannot join the batch above.
  const access = await getMyTabAccess(profile?.id ?? null);

  // Role gate — moved here from middleware, where it cost a profiles SELECT on
  // every single request. getSession() is request-memoized, so this is free.
  //
  // A missing profile row is fail-closed: never assume a role. A signed-in user
  // without one (trigger not run, deleted, unprovisioned) is sent to /login with
  // an explanation rather than into any area. This is the last line of defence
  // behind the 'employee' role default.
  if (!profile) {
    redirect('/login?error=Your+account+is+not+provisioned+yet.+Ask+HR+to+set+up+your+access.');
  }
  if (!isStaffRole(profile.role)) redirect('/me');

  // Per-tab access. This is the ONE place it is enforced, so a
  // route added later is covered without touching its page file. x-pathname is
  // set by middleware; if it is somehow absent we cannot identify the tab, and
  // the static per-page role gates still apply underneath.
  const slug = slugFromPathname(hdrs.get('x-pathname') ?? '');
  if (slug && !canAccessTab(profile.role, slug, access)) {
    // Bounce to the first tab they CAN open, never to a fixed '/today': if Today
    // itself is the revoked tab, redirecting there re-enters this layout and
    // loops forever. With every tab revoked there is no portal left to show, so
    // say so on /login rather than spinning.
    const fallback = NAV.find((n) => canAccessTab(profile.role, n.slug, access));
    redirect(
      fallback
        ? (`/${fallback.slug}` as Route)
        : '/login?error=Your+role+has+no+portal+access.+Ask+a+super+admin+to+restore+a+tab.',
    );
  }

  return (
    <div className="shell">
      <Sidebar name={profile?.full_name} role={profile?.role} access={access} />
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
