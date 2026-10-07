import './employee.css';
import { redirect } from 'next/navigation';
import { getSession, isStaffRole } from '@/lib/server-auth';
import { EmployeeSidebar } from '@/components/employee/EmployeeSidebar';
import { EmployeeTopbar } from '@/components/employee/EmployeeTopbar';
import { getMyNotifications, getUnreadNotificationCount } from '@/lib/queries/notifications';

// Employee self-service shell. Each tab renders inside the main content area, as in the portal.
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

  return (
    <div className="app-layout">
      <EmployeeSidebar name={profile.full_name} role={profile.role} />
      <main className="app-main">
        <EmployeeTopbar
          name={profile.full_name}
          avatar={profile.avatar ?? null}
          role={profile.role}
          email={email}
          notifications={notifications}
          unread={unread}
        />
        <section className="page-content">{children}</section>
      </main>
    </div>
  );
}

export { EmployeeLayout as default };
