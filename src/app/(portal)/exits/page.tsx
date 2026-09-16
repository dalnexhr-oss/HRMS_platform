import { redirect } from 'next/navigation';
import { ExitsScreen } from '@/components/exits/ExitsScreen';
import { getExitCases, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Match the exit actions' staff role gate.
const exitAdminRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function ExitsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !exitAdminRoles.includes(role)) {
    redirect('/today');
  }

  const [cases, employees] = await Promise.all([getExitCases(), getEmployeeOptions()]);
  return <ExitsScreen cases={cases} employees={employees} />;
}
