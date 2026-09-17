import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, isStaffRole } from '@/lib/auth';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { PunchToggle } from '@/components/employee/PunchToggle';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import { Brand } from '@/components/ui/Brand';
import { getMyNotifications, getUnreadNotificationCount } from '@/lib/queries';
import { ApprovalsShortcut } from '@/components/employee/ApprovalsShortcut';

// Employee self-service shell
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const [{ profile, email }, notifications, unread] = await Promise.all([
    getSession(),
    getMyNotifications(),
    getUnreadNotificationCount(),
  ]);

  // Staff use the portal. Accounts without a profile cannot enter either area.
  if (!profile) {
    redirect('/login?error=Your+account+is+not+provisioned+yet.+Ask+HR+to+set+up+your+access.');
  }
  if (isStaffRole(profile.role)) {
    redirect('/today');
  }

  const name = profile.full_name ?? 'Employee';

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <Link href="/me" aria-label="Employee dashboard" className="employee-home">
            <Brand priority />
          </Link>
          <div className="sub">Employee self-service</div>
        </div>
        <div className="grow" />
        <ApprovalsShortcut />
        <NotificationBell notifications={notifications} unread={unread} />
        <span className="who" style={{ marginRight: 4 }}>
          <ProfileMenu
            name={name}
            avatar={profile?.avatar ?? null}
            role={profile?.role ?? null}
            email={email}
            accountHref="/me/account"
          />
        </span>
        <PunchToggle />
      </div>
      <section className="screen">{children}</section>

      {/* End of the page: the one control you should have to go looking for. */}
      <footer className="me-foot">
        <div className="me-foot-id">
          <b>{name}</b>
          {email ? <span className="mono">{email}</span> : null}
        </div>
        <SignOutButton />
      </footer>
    </div>
  );
}
