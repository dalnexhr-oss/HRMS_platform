import './employee.css';
import { redirect } from 'next/navigation';
import { getSession, isStaffRole } from '@/lib/auth';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { PunchToggle } from '@/components/employee/PunchToggle';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import { Brand } from '@/components/ui/Brand';
import { getMyNotifications, getUnreadNotificationCount } from '@/lib/queries';
import { ApprovalsShortcut } from '@/components/employee/ApprovalsShortcut';

// Employee self-service shell
async function EmployeeLayout({ children }: { children: React.ReactNode }) {
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
    redirect('/dashboard');
  }

  const name = profile.full_name ?? 'Employee';

  return (
    <div className="app-main">
      <div className="app-header">
        <div>
          <Brand href="/employee" priority />
          <div className="subtitle">Employee Dashboard</div>
        </div>
        <div className="flex-spacer" />
        <ApprovalsShortcut />
        <NotificationBell notifications={notifications} unread={unread} />
        <span className="profile-summary" style={{ marginRight: 4 }}>
          <ProfileMenu
            name={name}
            avatar={profile?.avatar ?? null}
            role={profile?.role ?? null}
            email={email}
            accountHref="/employee/account"
          />
        </span>
        <PunchToggle />
      </div>
      <section className="page-content">{children}</section>

      {/* End of the page: the one control you should have to go looking for. */}
      <footer className="employee-footer">
        <div className="employee-footer-identity">
          <b>{name}</b>
          {email ? <span className="text-monospace">{email}</span> : null}
        </div>
        <SignOutButton />
      </footer>
    </div>
  );
}

export { EmployeeLayout as default };
