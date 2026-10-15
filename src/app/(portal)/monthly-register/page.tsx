import './monthly-register.css';
import { RegisterScreen } from '@/components/monthly-register/RegisterScreen';
import { getSession } from '@/lib/server-auth';
import { weekOffDaysInMonth } from '@/lib/attendance/weekly-off-policy';
import { currentPeriodMonth } from '@/lib/business-dates';
import { getBranches } from '@/lib/queries/branches';
import { getCompOffsForMonth } from '@/lib/queries/compensatory-off';
import { getLeaveRegisterMismatches, getRegister } from '@/lib/queries/attendance';
import { getPayrollRun } from '@/lib/queries/payroll';
import { getWeekOffPolicy } from '@/lib/queries/settings';
import type { AppRole } from '@/types/database';
import type { RegisterEmployee } from '@/types/domain';

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;

// Match attendance.ts writeRoles. Portal read access alone does not permit attendance corrections.
const correctionRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// '?m=YYYY-05' -> 'YYYY-05-01'. Anything unparseable falls back to the current month (IST).
function periodFromParam(m: string | undefined): string {
  return m && monthRe.test(m) ? `${m}-01` : currentPeriodMonth();
}

async function RegisterPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise.
  searchParams: Promise<{ m?: string; b?: string }>;
}) {
  const { m, b } = await searchParams;
  const periodMonth = periodFromParam(m);
  const branch = b && b.trim() ? b.trim() : null;

  let employees: RegisterEmployee[] = [];
  let run: Awaited<ReturnType<typeof getPayrollRun>> = null;
  let role: AppRole | null = null;
  let loadError: string | null = null;
  let compOffKeys: string[] = [];
  let scheduledWeekOffs: number[] = [];
  let branches: Awaited<ReturnType<typeof getBranches>> = [];
  let mismatches: Awaited<ReturnType<typeof getLeaveRegisterMismatches>> = [];
  try {
    // Catch any connection or session errors to display a friendly error message on the page.
    const [session, register, payrollRun, compOffs, policy, allBranches, leaveGaps] =
      await Promise.all([
        getSession(),
        getRegister(periodMonth, branch),
        getPayrollRun(periodMonth),
        getCompOffsForMonth(periodMonth),
        getWeekOffPolicy(),
        getBranches(),
        getLeaveRegisterMismatches(periodMonth, branch),
      ]);
    role = session.profile?.role ?? null;
    employees = register;
    run = payrollRun;
    compOffKeys = compOffs.map((c) => `${c.employeeId}|${c.earnedDate}`);
    scheduledWeekOffs = weekOffDaysInMonth(periodMonth, policy);
    branches = allBranches;
    mismatches = leaveGaps;
  } catch (e) {
    // Never swap in stand-in data to hide a real failure — show what broke.
    loadError = e instanceof Error ? e.message : String(e);
  }

  const canCorrect = role != null && correctionRoles.includes(role);

  return (
    <RegisterScreen
      periodMonth={periodMonth}
      branch={branch}
      monthParam={m && monthRe.test(m) ? m : periodMonth.slice(0, 7)}
      employees={employees}
      run={run}
      canCorrect={canCorrect}
      loadError={loadError}
      compOffKeys={compOffKeys}
      scheduledWeekOffs={scheduledWeekOffs}
      branches={branches}
      mismatches={mismatches}
    />
  );
}

export { RegisterPage as default };
