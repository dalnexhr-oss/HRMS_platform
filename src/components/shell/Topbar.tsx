'use client';

import { usePathname } from 'next/navigation';
import { pageHeader } from '@/lib/portal-navigation';
import { slugFromPathname } from '@/lib/portal-access';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import type { TopbarStats } from '@/lib/portal-navigation';
import type { NotificationRow } from '@/lib/queries/notifications';

function Topbar({
  // Let ProfileMenu use its neutral fallback when the profile has no name.
  name = null,
  avatar = null,
  role = null,
  email = null,
  notifications = [],
  unread = 0,
  stats = null,
}: {
  name?: string | null;
  avatar?: string | null;
  role?: string | null;
  email?: string | null;
  notifications?: NotificationRow[];
  unread?: number;
  // Live figures for the subtitle, resolved server-side by the portal layout.
  stats?: TopbarStats | null;
}) {
  const pathname = usePathname();
  const slug = slugFromPathname(pathname) || 'dashboard';
  // Subtitles carry live data (today's date, the current period, head-counts),
  // so they are derived rather than read from a static table.
  const [title, sub] = pageHeader(slug, stats);

  return (
    <div className="app-header">
      <div>
        <h2 id="tb-title">{title}</h2>
        <div className="subtitle" id="tb-sub">
          {sub}
        </div>
      </div>
      <div className="flex-spacer" />
      {/* Driven by the night_sweep_time setting — hidden when it is unset rather than advertising a sweep time the job does not actually use. */}
      {stats?.nightSweep && (
        <span
          className="status-badge"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
        >
          <span className="status-dot" style={{ background: 'var(--status-success)' }} />
          Night sweep armed · {stats.nightSweep}
        </span>
      )}
      <NotificationBell notifications={notifications} unread={unread} />
      <div className="profile-summary">
        <ProfileMenu name={name} avatar={avatar} role={role} email={email} accountHref="/account" />
      </div>
      <SignOutButton />
    </div>
  );
}

export { Topbar };
