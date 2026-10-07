'use client';

import { usePathname } from 'next/navigation';
import { PunchToggle } from '@/components/employee/PunchToggle';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import { employeeSlugFromPathname, employeeTabTitles } from '@/lib/employee-navigation';
import type { NotificationRow } from '@/lib/queries/notifications';

// Employee top bar: the current tab's title on the left, the punch clock as the last control.
function EmployeeTopbar({
  name = null,
  avatar = null,
  role = null,
  email = null,
  notifications = [],
  unread = 0,
}: {
  name?: string | null;
  avatar?: string | null;
  role?: string | null;
  email?: string | null;
  notifications?: NotificationRow[];
  unread?: number;
}) {
  const pathname = usePathname();
  const [title, subtitle] = employeeTabTitles[employeeSlugFromPathname(pathname)] ?? ['', ''];

  return (
    <div className="app-header">
      <div>
        <h2>{title}</h2>
        <div className="subtitle">{subtitle}</div>
      </div>
      <div className="flex-spacer" />
      <NotificationBell notifications={notifications} unread={unread} />
      <div className="profile-summary">
        <ProfileMenu
          name={name}
          avatar={avatar}
          role={role}
          email={email}
          accountHref="/employee/account"
        />
      </div>
      <PunchToggle />
    </div>
  );
}

export { EmployeeTopbar };
