import './register.css';
import Link from 'next/link';
import { AttendanceStatusBadge } from '@/components/ui/AttendanceStatusBadge';
import { getSession } from '@/lib/server-auth';
import { RegisterGrid } from '@/components/register/RegisterGrid';
import { registerLegend } from '@/lib/attendance-status';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { MonthNavigation } from '@/components/ui/MonthNavigation';
import { exportRegisterXlsx } from '@/lib/actions/export';
import { weekOffDaysInMonth } from '@/lib/weekly-off-policy';
import { minutesToHHMM, formatDate } from '@/lib/display-formatting';
import { currentPeriodMonth } from '@/lib/business-dates';
import { getBranches } from '@/lib/queries/branches';
import { getCompOffsForMonth } from '@/lib/queries/compensatory-off';
import { getLeaveRegisterMismatches, getRegister } from '@/lib/queries/attendance';
import { getPayrollRun } from '@/lib/queries/payroll';
import { getWeekOffPolicy } from '@/lib/queries/settings';
import type { Route } from 'next';
import type { AppRole } from '@/types/database';
import type { RegisterEmployee } from '@/types/domain';

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;

// Match attendance.ts writeRoles. Portal read access alone does not permit attendance corrections.
const correctionRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// '?m=YYYY-05' -> 'YYYY-05-01'. Anything unparseable falls back to the current month (IST).
function periodFromParam(m: string | undefined): string {
  return m && monthRe.test(m) ? `${m}-01` : currentPeriodMonth();
}


function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Shift a 'YYYY-MM-01' by ±n months, returning the '?m=' param form 'YYYY-MM'. */
function shiftMonthParam(periodMonth: string, delta: number): string {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(periodMonth: string): number[] {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => i + 1);
}

/**
 * A day is a week-off *column* when every employee who has a row that day is on
 * a week off. Derived from the data rather than a fixed calendar, so it stays
 * correct for any month.
 */
function deriveWeekOffs(employees: RegisterEmployee[], days: number[]): number[] {
  return days.filter((d) => {
    const cells = employees.map((e) => e.days.find((c) => c.day === d)).filter((c) => c != null);
    return cells.length > 0 && cells.every((c) => c.isWeekOff);
  });
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

  const days = daysInMonth(periodMonth);
  // The schedule (Sundays + 1st/3rd/5th Saturdays) is authoritative for which
  // columns are week-offs. Days the data shows as WO for everyone are unioned in
  // so a one-off closure still greys out.
  const weekOffs = Array.from(
    new Set([...scheduledWeekOffs, ...deriveWeekOffs(employees, days)]),
  ).sort((a, b) => a - b);
  const prev = shiftMonthParam(periodMonth, -1);
  const next = shiftMonthParam(periodMonth, 1);

  // Preserve the current month when switching branch, and vice-versa.
  const withParams = (mm: string, bb: string | null): Route =>
    `/monthly-register?m=${mm}${bb ? `&b=${encodeURIComponent(bb)}` : ''}` as Route;

  return (
    <div className="content-container register-page">
      <div className="period-toolbar">
        <MonthNavigation
          label={monthLabel(periodMonth)}
          previousHref={withParams(prev, branch)}
          nextHref={withParams(next, branch)}
        />

        {branches.length > 0 && (
          <div className="legend" role="group" aria-label="Filter by branch">
            <Link
              href={withParams(m && monthRe.test(m) ? m : periodMonth.slice(0, 7), null)}
              className="status-badge"
              style={
                branch == null
                  ? { borderColor: 'var(--brand)', color: 'var(--brand)' }
                  : { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }
              }
            >
              All branches
            </Link>
            {branches.map((br) => {
              const on = branch === br.name;
              return (
                <Link
                  key={br.id}
                  href={withParams(m && monthRe.test(m) ? m : periodMonth.slice(0, 7), br.name)}
                  className="status-badge"
                  style={
                    on
                      ? { borderColor: 'var(--brand)', color: 'var(--brand)' }
                      : { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }
                  }
                >
                  {br.name}
                </Link>
              );
            })}
          </div>
        )}

        {run && (run.workingDays != null || run.targetMinutes != null) && (
          <span
            className="status-badge"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
          >
            {run.workingDays ?? '—'} working days · target{' '}
            <b className="text-monospace">
              &nbsp;{run.targetMinutes != null ? minutesToHHMM(run.targetMinutes) : '—'}
            </b>
          </span>
        )}

        {run && (
          <span
            className="status-badge"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
          >
            Payroll · {run.status.replace('_', ' ')}
          </span>
        )}

        <div className="legend">
          {registerLegend.map(([k]) => (
            <AttendanceStatusBadge key={k} status={k} />
          ))}
        </div>

        {canCorrect && !loadError && employees.length > 0 && (
          <>
            <span style={{ flex: 1 }} />
            <XlsxExportButton action={exportRegisterXlsx.bind(null, periodMonth)} label="Excel" />
          </>
        )}
      </div>

      {loadError ? (
        <div className="card">
          <div className="card-body">
            <div className="error-message">Could not load the register: {loadError}</div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
              The register is showing nothing rather than stand-in data — fix the error above and
              reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          {canCorrect && mismatches.length > 0 && (
            <div
              className="card"
              style={{ marginBottom: 12, borderColor: 'var(--attendance-late-border)' }}
            >
              <div className="card-header">
                <h3>Approved leave not on the register</h3>
                <span className="card-caption">
                  {mismatches.length} day{mismatches.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="card-body">
                <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
                  These employees have an <b>approved</b> leave request for these days, but the
                  register shows them absent (or has no row). Approving leave draws down the balance
                  but does not stamp the register — mark the day <b>L</b> here so pay and the
                  register agree.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Date</th>
                        <th>Leave</th>
                        <th>Register shows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mismatches.map((mm) => (
                        <tr key={`${mm.employeeId}|${mm.date}`}>
                          <td>
                            <b>{mm.name}</b>{' '}
                            <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                              {mm.code}
                            </span>
                          </td>
                          <td className="text-monospace">{formatDate(mm.date)}</td>
                          <td>{mm.leaveKind ?? 'Leave'}</td>
                          <td>
                            <span
                              className="status-badge"
                              style={{
                                borderColor: 'var(--border-strong)',
                                color: 'var(--attendance-half-day)',
                              }}
                            >
                              {mm.registerStatus ?? 'no entry'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <RegisterGrid
            key={`${periodMonth}:${branch ?? ''}`}
            employees={employees}
            days={days}
            weekOffs={weekOffs}
            periodMonth={periodMonth}
            canCorrect={canCorrect}
            compOffKeys={compOffKeys}
          />
        </>
      )}
    </div>
  );
}

export { RegisterPage as default };
