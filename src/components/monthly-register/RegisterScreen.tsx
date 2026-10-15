import Link from 'next/link';
import { AttendanceStatusBadge } from '@/components/ui/AttendanceStatusBadge';
import { RegisterGrid } from '@/components/monthly-register/RegisterGrid';
import { registerLegend } from '@/lib/attendance/attendance-status';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { MonthNavigation } from '@/components/ui/MonthNavigation';
import { exportRegisterXlsx } from '@/lib/actions/export';
import { minutesToHHMM, formatDate } from '@/lib/display-formatting';
import type { Route } from 'next';
import type { RegisterEmployee } from '@/types/domain';
import type { BranchRow } from '@/lib/queries/branches';
import type { LeaveRegisterMismatch } from '@/lib/queries/attendance';
import type { PayrollRunView } from '@/lib/queries/payroll';

function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

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

function deriveWeekOffs(employees: RegisterEmployee[], days: number[]): number[] {
  return days.filter((d) => {
    const cells = employees.map((e) => e.days.find((c) => c.day === d)).filter((c) => c != null);
    return cells.length > 0 && cells.every((c) => c.isWeekOff);
  });
}

function RegisterScreen({
  periodMonth,
  branch,
  monthParam,
  employees,
  run,
  canCorrect,
  loadError,
  compOffKeys,
  scheduledWeekOffs,
  branches,
  mismatches,
}: {
  periodMonth: string;
  branch: string | null;
  monthParam: string;
  employees: RegisterEmployee[];
  run: PayrollRunView | null;
  canCorrect: boolean;
  loadError: string | null;
  compOffKeys: string[];
  scheduledWeekOffs: number[];
  branches: BranchRow[];
  mismatches: LeaveRegisterMismatch[];
}) {
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
    <div className="content-container register-page monthly-register-page">
      <div className="period-toolbar">
        <MonthNavigation
          label={monthLabel(periodMonth)}
          previousHref={withParams(prev, branch)}
          nextHref={withParams(next, branch)}
        />

        {branches.length > 0 && (
          <div className="legend" role="group" aria-label="Filter by branch">
            <Link
              href={withParams(monthParam, null)}
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
                  href={withParams(monthParam, br.name)}
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
          <span className="status-badge register-summary-tag">
            {run.workingDays ?? '—'} working days · target{' '}
            <b className="text-monospace">
              &nbsp;{run.targetMinutes != null ? minutesToHHMM(run.targetMinutes) : '—'}
            </b>
          </span>
        )}

        {run && (
          <span className="status-badge register-summary-tag">
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
            <span className="register-toolbar-spacer" />
            <XlsxExportButton action={exportRegisterXlsx.bind(null, periodMonth)} label="Excel" />
          </>
        )}
      </div>

      {loadError ? (
        <div className="card">
          <div className="card-body">
            <div className="error-message">Could not load the register: {loadError}</div>
            <p className="text-muted register-load-note">
              The register is showing nothing rather than stand-in data — fix the error above and
              reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          {canCorrect && mismatches.length > 0 && (
            <div className="card register-leave-gaps">
              <div className="card-header">
                <h3>Approved leave not on the register</h3>
                <span className="card-caption">
                  {mismatches.length} day{mismatches.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="card-body">
                <p className="text-muted register-leave-note">
                  These employees have an <b>approved</b> leave request for these days, but the
                  register shows them absent (or has no row). Approving leave draws down the balance
                  but does not stamp the register — mark the day <b>L</b> here so pay and the
                  register agree.
                </p>
                <div className="register-gaps-table">
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
                            <span className="text-monospace text-muted register-employee-code">
                              {mm.code}
                            </span>
                          </td>
                          <td className="text-monospace">{formatDate(mm.date)}</td>
                          <td>{mm.leaveKind ?? 'Leave'}</td>
                          <td>
                            <span className="status-badge register-gap-status">
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

export { RegisterScreen };
