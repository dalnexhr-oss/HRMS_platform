import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { getSession, isStaffRole } from '@/lib/auth';
import { canAccessTab, slugFromPathname } from '@/lib/access';
import { navItems } from '@/lib/constants';
import { getMyNotifications, getUnreadNotificationCount, getTopbarStats, getMyTabAccess } from '@/lib/queries';
import type { Route } from 'next';

// Shared portal shell. Each route renders inside the main content area.
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

  // Resolve the role from the request-cached session. A missing profile cannot grant portal
  // access.
  if (!profile) {
    redirect('/login?error=Your+account+is+not+provisioned+yet.+Ask+HR+to+set+up+your+access.');
  }
  if (!isStaffRole(profile.role)) {
    redirect('/me');
  }

  // Enforce per-tab access for all portal pages. Middleware supplies x-pathname; page-level role
  // checks still apply when it is missing.
  const slug = slugFromPathname(hdrs.get('x-pathname') ?? '');
  if (slug && !canAccessTab(profile.role, slug, access)) {
    // Redirect to an accessible tab to avoid a loop when Today is revoked. With no accessible
    // tabs, return to login with an explanation.
    const fallback = navItems.find((n) => canAccessTab(profile.role, n.slug, access));
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
