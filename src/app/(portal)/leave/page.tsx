import { redirect } from 'next/navigation';
import { LeaveAdmin } from '@/components/leave/LeaveAdmin';
import {
  getLeaveBalancesForYear,
  getLeaveEncashments,
  getLeaveAdjustments,
  getEmployeeOptions,
} from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Leave administration writes entitlements and money — admin/HR only, matching
// the server actions' requireRoles(['admin','hr']) gate.
const LEAVE_ADMIN_ROLES: AppRole[] = ['admin', 'hr'];

const YEAR_RE = /^\d{4}$/;

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !LEAVE_ADMIN_ROLES.includes(role)) redirect('/today');

  const { y } = await searchParams;
  // Default to the current leave year; ?y= lets HR open a prior/next one.
  const year = y && YEAR_RE.test(y) ? Number(y) : new Date().getFullYear();

  const [balances, encashments, adjustments, employees] = await Promise.all([
    getLeaveBalancesForYear(year),
    getLeaveEncashments(),
    getLeaveAdjustments(),
    getEmployeeOptions(),
  ]);

  return (
    <LeaveAdmin
      year={year}
      balances={balances}
      encashments={encashments}
      adjustments={adjustments}
      employees={employees}
    />
  );
}
