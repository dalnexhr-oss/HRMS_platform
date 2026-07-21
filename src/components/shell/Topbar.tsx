'use client';

import { usePathname } from 'next/navigation';
import { TITLES } from '@/lib/constants';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import type { NotificationRow } from '@/lib/queries';

export function Topbar({
  name = 'Meera Kulkarni',
  notifications = [],
  unread = 0,
}: {
  name?: string;
  notifications?: NotificationRow[];
  unread?: number;
}) {
  const pathname = usePathname();
  const slug = pathname.split('/')[1] || 'today';
  const [title, sub] = TITLES[slug] ?? ['', ''];

  return (
    <div className="topbar">
      <div>
        <h2 id="tb-title">{title}</h2>
        <div className="sub" id="tb-sub">
          {sub}
        </div>
      </div>
      <div className="grow" />
      <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
        <span className="dot" style={{ background: 'var(--ok)' }} />
        Night sweep armed · 11:00 PM
      </span>
      <NotificationBell notifications={notifications} unread={unread} />
      <div className="who">
        <span className="av">{initials(name)}</span>
      </div>
      <SignOutButton />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
