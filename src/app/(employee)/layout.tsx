import { getSession } from '@/lib/auth';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { Brand } from '@/components/ui/Brand';
import { getMyNotifications, getUnreadNotificationCount } from '@/lib/queries';

// Employee self-service shell — a slim top bar, no admin sidebar.
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const [{ profile }, notifications, unread] = await Promise.all([
    getSession(),
    getMyNotifications(),
    getUnreadNotificationCount(),
  ]);
  const name = profile?.full_name ?? 'Employee';

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <Brand priority />
          <div className="sub">Employee self-service</div>
        </div>
        <div className="grow" />
        <NotificationBell notifications={notifications} unread={unread} />
        <span className="who" style={{ marginRight: 4 }}>
          <span className="av">{initials(name)}</span>
        </span>
        <SignOutButton />
      </div>
      <section className="screen">{children}</section>
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
