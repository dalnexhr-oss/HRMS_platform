import type { Route } from 'next';
import Link from 'next/link';
import { RegisterGrid } from '@/components/register/RegisterGrid';
import { Stamp } from '@/components/ui/Stamp';
import { REGISTER_LEGEND } from '@/lib/constants';
import {
  DEFAULT_PERIOD_MONTH,
  getCompOffsForMonth,
  getPayrollRun,
  getRegister,
  getWeekOffPolicy,
  isSupabaseConfigured,
} from '@/lib/queries';
import { weekOffDaysInMonth } from '@/lib/week-off';
import { getSession } from '@/lib/auth';
import { minutesToHHMM } from '@/lib/format';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportRegisterXlsx } from '@/lib/actions/export';
import type { AppRole } from '@/types/database';
import type { RegisterEmployee } from '@/types/domain';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Roles offered the correction UI — must match WRITE_ROLES in
 * src/lib/actions/attendance.ts, which in turn matches SQL is_staff() behind the
 * attendance_days_write policy. NOT isStaffRole(): that includes 'viewer', which
 * 0003 defines as read-only, so viewers would get a drawer Postgres then rejects.
 */
const CORRECTION_ROLES: AppRole[] = ['admin', 'hr', 'manager'];

/** '?m=2026-05' -> '2026-05-01'. Anything unparseable falls back to the default. */
function periodFromParam(m: string | undefined): string {
  return m && MONTH_RE.test(m) ? `${m}-01` : DEFAULT_PERIOD_MONTH;
}

/** '2026-06-01' -> 'JUNE 2026'. */
function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00`)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    .toUpperCase();
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
 * a week off. Derived from the data rather than a hardcoded demo calendar, so
 * it stays correct for any month.
 */
function deriveWeekOffs(employees: RegisterEmployee[], days: number[]): number[] {
  return days.filter((d) => {
    const cells = employees.map((e) => e.days.find((c) => c.day === d)).filter((c) => c != null);
    return cells.length > 0 && cells.every((c) => c.isWeekOff);
  });
}

export default async function RegisterPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise.
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const periodMonth = periodFromParam(m);
  const configured = isSupabaseConfigured();

  // The demo dataset is a single hardcoded month, so month navigation would be
  // a lie there — the label would move while the data stood still.
  const canNavigate = configured;

  let employees: RegisterEmployee[] = [];
  let run: Awaited<ReturnType<typeof getPayrollRun>> = null;
  let role: AppRole | null = null;
  let loadError: string | null = null;
  let compOffKeys: string[] = [];
  let scheduledWeekOffs: number[] = [];
  try {
    // getSession() throws when the profile lookup fails (e.g. schema not
    // applied), so it belongs inside the same guard — outside it, the error card
    // below is unreachable and the page dies with a stack trace instead.
    const [session, register, payrollRun, compOffs, policy] = await Promise.all([
      getSession(),
      getRegister(periodMonth),
      getPayrollRun(periodMonth),
      getCompOffsForMonth(periodMonth),
      getWeekOffPolicy(),
    ]);
    role = session.profile?.role ?? null;
    employees = register;
    run = payrollRun;
    compOffKeys = compOffs.map((c) => `${c.employeeId}|${c.earnedDate}`);
    scheduledWeekOffs = weekOffDaysInMonth(periodMonth, policy);
  } catch (e) {
    // Never swap in demo data to hide a real failure — show what broke.
    loadError = e instanceof Error ? e.message : String(e);
  }

  // Corrections need somewhere to write. In demo mode the action correctly
  // refuses every save, so offering the drawer would be a control that cannot
  // succeed — the exact dead UI the brief forbids.
  const canCorrect = configured && role != null && CORRECTION_ROLES.includes(role);

  const days = daysInMonth(periodMonth);
  // The schedule (Sundays + 1st/3rd/5th Saturdays) is authoritative for which
  // columns are week-offs. Days the DATA shows as WO for everyone are unioned in
  // so a one-off closure still greys out, and so demo mode (no settings) still
  // renders its seeded week-offs.
  const weekOffs = Array.from(
    new Set([...scheduledWeekOffs, ...deriveWeekOffs(employees, days)]),
  ).sort((a, b) => a - b);
  const prev = shiftMonthParam(periodMonth, -1);
  const next = shiftMonthParam(periodMonth, 1);

  return (
    <div className="wrap">
      <div className="reg-head">
        <div className="month-nav">
          {canNavigate ? (
            <>
              <Link
                href={`/register?m=${prev}` as Route}
                aria-label="Previous month"
                role="button"
              >
                ‹
              </Link>
              <span className="cur">{monthLabel(periodMonth)}</span>
              <Link href={`/register?m=${next}` as Route} aria-label="Next month" role="button">
                ›
              </Link>
            </>
          ) : (
            <>
              <button aria-label="Previous month" disabled title="Demo data covers one month only">
                ‹
              </button>
              <span className="cur">{monthLabel(periodMonth)}</span>
              <button aria-label="Next month" disabled title="Demo data covers one month only">
                ›
              </button>
            </>
          )}
        </div>

        {run && (run.workingDays != null || run.targetMinutes != null) && (
          <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
            {run.workingDays ?? '—'} working days · target{' '}
            <b className="mono">&nbsp;{run.targetMinutes != null ? minutesToHHMM(run.targetMinutes) : '—'}</b>
          </span>
        )}

        {run && (
          <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
            Payroll · {run.status.replace('_', ' ')}
          </span>
        )}

        {!configured && (
          <span
            className="pill"
            style={{ borderColor: 'var(--brass)', color: 'var(--brass)', background: 'var(--brass-soft)' }}
          >
            Demo data — from your Excel
          </span>
        )}

        <div className="legend">
          {REGISTER_LEGEND.map(([k]) => (
            <Stamp key={k} status={k} />
          ))}
        </div>

        {canCorrect && !loadError && employees.length > 0 && (
          <>
            <span style={{ flex: 1 }} />
            <XlsxExportButton
              action={exportRegisterXlsx.bind(null, periodMonth)}
              label="Export .xlsx"
            />
          </>
        )}
      </div>

      {loadError ? (
        <div className="card">
          <div className="bd">
            <div className="login-error">Could not load the register: {loadError}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              The register is showing nothing rather than stand-in data — fix the error above and
              reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          <RegisterGrid
            employees={employees}
            days={days}
            weekOffs={weekOffs}
            periodMonth={periodMonth}
            canCorrect={canCorrect}
            compOffKeys={compOffKeys}
          />

          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Click a row to open punch detail (In / Out / Hours).{' '}
            {canCorrect
              ? 'Click any day to correct it — every manual correction asks for a reason and is written to the audit log.'
              : !configured
                ? 'Corrections need a database connection; this demo register is read-only.'
                : role === 'viewer'
                  ? 'Your role is read-only, so corrections are disabled — ask an admin or HR to make a change.'
                  : 'Corrections are restricted to admin, HR and managers.'}
          </p>
        </>
      )}
    </div>
  );
}
