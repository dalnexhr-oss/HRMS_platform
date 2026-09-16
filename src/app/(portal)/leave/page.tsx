import { redirect } from 'next/navigation';
import { LeaveSalaryAdmin } from '@/components/leave/LeaveSalaryAdmin';
import { buildLeaveSalaryView } from '@/lib/leave-salary-view';
import { getLeaveBalancesForYear } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { exportLeaveSalaryXlsx } from '@/lib/actions/export';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import type { AppRole } from '@/types/database';

// Match the leave-salary actions' staff role gate.
const leaveAdminRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

const yearRe = /^\d{4}$/;

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !leaveAdminRoles.includes(role)) redirect('/today');

  const { y } = await searchParams;
  // Default to the current year; ?y= lets HR open a prior/next one.
  const year = y && yearRe.test(y) ? Number(y) : new Date().getFullYear();

  const [view, pool] = await Promise.all([
    buildLeaveSalaryView(year),
    getLeaveBalancesForYear(year),
  ]);

  return (
    <LeaveSalaryAdmin
      year={year}
      migrated={view.migrated}
      rows={view.rows}
      pool={pool}
      exportSlot={
        <XlsxExportButton action={exportLeaveSalaryXlsx.bind(null, year)} label="Export .xlsx" />
      }
    />
  );
}
