'use client';

import { usePathname } from 'next/navigation';
import { TITLES } from '@/lib/constants';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import type { NotificationRow } from '@/lib/queries';

export function Topbar({
  name = 'Meera Kulkarni',
  avatar = null,
  role = null,
  email = null,
  notifications = [],
  unread = 0,
}: {
  name?: string;
  avatar?: string | null;
  role?: string | null;
  email?: string | null;
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
        <ProfileMenu name={name} avatar={avatar} role={role} email={email} accountHref="/account" />
      </div>
      <SignOutButton />
    </div>
  );
}
