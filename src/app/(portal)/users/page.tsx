import { redirect } from 'next/navigation';
import { UsersScreen } from '@/components/users/UsersScreen';
import { listUsers } from '@/lib/actions/users';
import { getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// User administration is admin/HR only. Anyone else is bounced rather than shown
// a screen whose every control would be refused.
const USER_ADMIN_ROLES: AppRole[] = ['admin', 'hr'];

export default async function UsersPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !USER_ADMIN_ROLES.includes(role)) redirect('/today');

  const [result, employees] = await Promise.all([listUsers(), getEmployeeOptions()]);

  return (
    <UsersScreen
      users={result.ok ? result.users : []}
      employees={employees}
      callerRole={role}
      selfId={profile?.id ?? null}
      loadError={result.ok ? null : result.error}
    />
  );
}
