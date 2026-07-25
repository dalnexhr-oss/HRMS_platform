'use client';

import { usePathname } from 'next/navigation';
import { pageHeader, type TopbarStats } from '@/lib/constants';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import type { NotificationRow } from '@/lib/queries';

export function Topbar({
  // No placeholder identity: an unnamed profile falls back to a neutral label in
  // ProfileMenu ("Signed in") rather than showing a real person's name to
  // whoever happens to be logged in.
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
  /** Live figures for the subtitle, resolved server-side by the portal layout. */
  stats?: TopbarStats | null;
}) {
  const pathname = usePathname();
  const slug = pathname.split('/')[1] || 'today';
  // Subtitles carry live data (today's date, the current period, head-counts),
  // so they are derived rather than read from a static table.
  const [title, sub] = pageHeader(slug, stats);

  return (
    <div className="topbar">
      <div>
        <h2 id="tb-title">{title}</h2>
        <div className="sub" id="tb-sub">
          {sub}
        </div>
      </div>
      <div className="grow" />
      {/* Driven by the night_sweep_time setting — hidden when it is unset rather
          than advertising a sweep time the job does not actually use. */}
      {stats?.nightSweep && (
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          <span className="dot" style={{ background: 'var(--ok)' }} />
          Night sweep armed · {stats.nightSweep}
        </span>
      )}
      <NotificationBell notifications={notifications} unread={unread} />
      <div className="who">
        <ProfileMenu name={name} avatar={avatar} role={role} email={email} accountHref="/account" />
      </div>
      <SignOutButton />
    </div>
  );
}
