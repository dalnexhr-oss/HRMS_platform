import { redirect } from 'next/navigation';
import { ExitsScreen } from '@/components/exits/ExitsScreen';
import { getExitCases, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Exits disable logins and move money — admin/HR only, matching the server
// actions' requireRoles(['admin','hr']) gate.
const EXIT_ADMIN_ROLES: AppRole[] = ['admin', 'hr'];

export default async function ExitsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !EXIT_ADMIN_ROLES.includes(role)) redirect('/today');

  const [cases, employees] = await Promise.all([getExitCases(), getEmployeeOptions()]);
  return <ExitsScreen cases={cases} employees={employees} />;
}
