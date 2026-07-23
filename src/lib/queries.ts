// ============================================================================
// Data access layer. These run in Server Components.
//
// THE ONE RULE — read before editing:
//   Demo data is served ONLY when Supabase is not configured. When Supabase IS
//   configured and a query fails, the error is THROWN, not swallowed into demo
//   data. A broken database must never be indistinguishable from a working one.
//
//   if (!isSupabaseConfigured()) return demoX();       // legit demo mode
//   const { data, error } = await ...;
//   if (error) fail('context', error);                 // surface it
//   return map(data);
//
// A legitimately empty result (no payroll run for the month yet) returns an
// empty array — that is an empty state, not an error, and not a reason to fake.
// ============================================================================
import { createClient } from '@/lib/supabase/server';
import {
  DATA, ACTIVITY, CELEBRATIONS, PUNCH_LOG, DEMO_POLICIES, DEMO_SETTINGS,
  DEMO_HOLIDAYS, DEMO_NOTICES, DEMO_TICKETS, DEMO_REQUESTS,
} from '@/lib/demo-data';
import { minutesToHHMM, trimTime } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  DEFAULT_WEEK_OFF_POLICY,
  policyFromSettings,
  type WeekOffPolicy,
} from '@/lib/week-off';
import type {
  RegisterEmployee, PayslipRow, DayCell, TodayKpis, Celebration, PunchLogRow,
} from '@/types/domain';
import type { AttendanceStatus, Policy, LeaveType, RequestType } from '@/types/database';

// Re-exported: ~8 action files already import isSupabaseConfigured from here.
// The implementation now lives in @/lib/supabase/env (single source of truth).
export { isSupabaseConfigured };

// ------------------------------------------------------------------ utils ---

/** The month the ported prototype data describes; the default period everywhere. */
export const DEFAULT_PERIOD_MONTH = '2026-06-01';

interface QueryError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

/**
 * Turn a PostgrestError into a real, debuggable Error and throw it. Supabase
 * errors are plain objects; throwing them raw loses the stack and renders as
 * "{}" in Next's error overlay.
 */
function fail(context: string, error: QueryError): never {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
  const code = error.code ? ` (${error.code})` : '';
  throw new Error(`${context}: ${detail}${code}`);
}

/**
 * True when the error is "this relation does not exist" — i.e. a migration has
 * not been applied to this database yet.
 *
 *   PGRST205  PostgREST: table not found in the schema cache
 *   42P01     Postgres:  undefined_table
 *
 * This is deliberately NARROW and is the one exception to the house rule that a
 * real Supabase error must never be swallowed. It distinguishes "the query
 * failed" (a real fault worth surfacing) from "this feature is not deployed in
 * this environment", which is a deployment state, not a fault. Only the tables
 * added by later migrations use it, so a half-migrated database degrades the
 * affected card instead of taking down the whole dashboard. Every other error —
 * permissions, RLS, network — still throws.
 */
function isMissingTable(error: QueryError): boolean {
  return error.code === 'PGRST205' || error.code === '42P01';
}

/** Log once, loudly, so an un-migrated deployment is obvious in the server logs. */
function warnNotMigrated(context: string, migration: string): void {
  console.warn(
    `[dalnex-hrms] ${context}: table missing — apply ${migration} ` +
      '(npx supabase db push, or paste it in the Supabase SQL Editor). ' +
      'Returning no rows so the rest of the page still renders.',
  );
}

/** '2026-06-01' -> { start: '2026-06-01', end: '2026-06-30' } */
function monthRange(periodMonth: string): { start: string; end: string } {
  const start = periodMonth.slice(0, 8) + '01';
  const d = new Date(start + 'T00:00:00Z');
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start, end: end.toISOString().slice(0, 10) };
}

/**
 * Today's date in the business timezone. The SQL views use the database's
 * current_date; this keeps app-side date filters on the same calendar day.
 */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** minutes -> '3h 23m' (the punch log's "active" column). */
function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** timestamptz -> '11:00 PM' in the business timezone. */
function clockTime(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(ts));
}

/** The demo activity feed carries <b> markup; ActivityRow.message is plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

const PAYSLIP_FIELDS = `payable_days, earned_gross, shortfall_amount, per_day_rate,
  basic_earned, hra_earned, special_earned, pf_employee, pf_employer, esic_employee,
  esic_employer, professional_tax, net_payable, shortfall_minutes`;

function mapPayslip(p: any): PayslipRow {
  return {
    id: p.employees?.code ?? p.id,
    code: p.employees?.code ?? '',
    name: p.employees?.full_name ?? '',
    branch: p.employees?.branches?.name ?? '',
    state: p.employees?.branches?.state,
    periodMonth: p.payroll_runs?.period_month ?? null,
    payableDays: Number(p.payable_days),
    earnedGross: Number(p.earned_gross),
    shortfallAmount: Number(p.shortfall_amount),
    perDayRate: Number(p.per_day_rate),
    basicEarned: Number(p.basic_earned),
    hraEarned: Number(p.hra_earned),
    specialEarned: Number(p.special_earned),
    pfEmployee: Number(p.pf_employee),
    pfEmployer: Number(p.pf_employer),
    esicEmployee: Number(p.esic_employee),
    esicEmployer: Number(p.esic_employer),
    professionalTax: Number(p.professional_tax),
    netPayable: Number(p.net_payable),
    shortfallMinutes: p.shortfall_minutes,
  };
}

// --------------------------------------------------------------- register ---
function demoDayCells(e: (typeof DATA.employees)[number]): DayCell[] {
  const wo = new Set(DATA.week_offs);
  return e.statuses.map<DayCell>((status, ix) => {
    const t = e.times[ix];
    const hasPunch = t && t.in !== '00:00';
    return {
      day: ix + 1,
      status: status as AttendanceStatus,
      in: hasPunch ? t.in : null,
      out: hasPunch ? t.out : null,
      hours: hasPunch ? t.hrs : null,
      isWeekOff: wo.has(ix + 1),
    };
  });
}

function demoRegister(): RegisterEmployee[] {
  return DATA.employees.map((e) => ({
    id: e.code,
    code: e.code,
    name: e.name,
    branch: e.branch,
    gender: e.gender,
    doj: e.doj,
    summary: {
      P: e.sum.P, LM: e.sum.LM, HD: e.sum.HD, L: e.sum.L, WO: e.sum.WO,
      working: e.sum.working, payable: e.sum.payable,
    },
    workedMinutes: e.worked_min,
    targetMinutes: e.target_min,
    days: demoDayCells(e),
  }));
}

export async function getRegister(
  periodMonth: string = DEFAULT_PERIOD_MONTH,
): Promise<RegisterEmployee[]> {
  if (!isSupabaseConfigured()) return demoRegister();

  const { start, end } = monthRange(periodMonth);
  const supabase = await createClient();

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, code, full_name, gender, date_of_joining, branches(name)')
    .eq('status', 'active')
    .order('code');
  if (error) fail('getRegister: could not load employees', error);
  if (!employees?.length) return [];

  const { data: days, error: daysError } = await supabase
    .from('attendance_days')
    .select('employee_id, work_date, status, punch_in, punch_out, worked_minutes')
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date');
  if (daysError) fail('getRegister: could not load attendance', daysError);

  // The run carries the month's target minutes; without one there is no target.
  const { data: run, error: runError } = await supabase
    .from('payroll_runs')
    .select('target_minutes')
    .eq('period_month', start)
    .maybeSingle();
  if (runError) fail('getRegister: could not load the payroll run', runError);

  const byEmployee = new Map<string, any[]>();
  for (const d of days ?? []) {
    const list = byEmployee.get((d as any).employee_id);
    if (list) list.push(d);
    else byEmployee.set((d as any).employee_id, [d]);
  }

  return employees.map((e: any) => {
    const rows = byEmployee.get(e.id) ?? [];
    const cells: DayCell[] = rows.map((d: any) => ({
      day: Number(d.work_date.slice(8, 10)),
      status: d.status,
      in: trimTime(d.punch_in),
      out: trimTime(d.punch_out),
      hours: d.worked_minutes ? minutesToHHMM(d.worked_minutes) : null,
      // Week-offs come from the resolved status, not a hardcoded demo calendar.
      isWeekOff: d.status === 'WO',
    }));
    const workedMinutes = rows.reduce((a: number, d: any) => a + (d.worked_minutes ?? 0), 0);
    const count = (s: string) => rows.filter((d: any) => d.status === s).length;
    // Mirrors v_monthly_attendance_summary / fn_compute_payslip: field days (S/T)
    // count as worked, half-days as 0.5, and paid leave is payable but not worked.
    const working = count('P') + count('LM') + count('S') + count('T') + 0.5 * count('HD');
    return {
      id: e.id,
      code: e.code,
      name: e.full_name,
      branch: e.branches?.name ?? '',
      gender: e.gender,
      doj: e.date_of_joining,
      summary: {
        P: count('P'), LM: count('LM'), HD: count('HD'), L: count('L'), WO: count('WO'),
        working,
        payable: working + count('L'),
      },
      workedMinutes,
      targetMinutes: run?.target_minutes ?? 0,
      days: cells,
    };
  });
}

// --------------------------------------------------------------- payroll ---
function demoPayslips(): PayslipRow[] {
  return DATA.employees.map((e) => ({
    id: e.code,
    code: e.code,
    name: e.name,
    branch: e.branch,
    state: e.branch === 'Vadodara' ? 'Gujarat' : 'Maharashtra',
    periodMonth: DEFAULT_PERIOD_MONTH,
    payableDays: e.sum.payable,
    earnedGross: e.pay.earned,
    shortfallAmount: e.pay.shortfall,
    perDayRate: e.pay.perday,
    basicEarned: e.pay.basic_e,
    hraEarned: e.pay.hra_e,
    specialEarned: e.pay.spl_e,
    pfEmployee: e.pay.pf,
    pfEmployer: e.pay.pf_er,
    esicEmployee: e.pay.esic,
    esicEmployer: e.pay.esic_er,
    professionalTax: e.pay.pt,
    netPayable: e.pay.net,
    shortfallMinutes: e.pay.shortmin,
  }));
}

export async function getPayslips(
  periodMonth: string = DEFAULT_PERIOD_MONTH,
): Promise<PayslipRow[]> {
  if (!isSupabaseConfigured()) return demoPayslips();

  const { start } = monthRange(periodMonth);
  const supabase = await createClient();

  const { data: run, error: runError } = await supabase
    .from('payroll_runs')
    .select('id')
    .eq('period_month', start)
    .maybeSingle();
  if (runError) fail('getPayslips: could not load the payroll run', runError);
  if (!run) return []; // no run for this month yet — a real empty state

  const { data, error } = await supabase
    .from('payslips')
    .select(`${PAYSLIP_FIELDS}, employees(code, full_name, branches(name, state))`)
    .eq('payroll_run_id', run.id);
  if (error) fail('getPayslips: could not load payslips', error);

  return (data ?? [])
    .map(mapPayslip)
    // The select filters by run.id rather than joining payroll_runs, so stamp the
    // known period month here so each row is labelled by month.
    .map((r) => ({ ...r, periodMonth: start }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

// ------------------------------------------------------------ payroll runs ---
export interface PayrollRunView {
  id: string;
  periodMonth: string;
  status: 'draft' | 'in_review' | 'locked' | 'paid';
  workingDays: number | null;
  targetMinutes: number | null;
  monthClosedAt: string | null;
  draftsComputedAt: string | null;
  lockedAt: string | null;
  paidAt: string | null;
}

function mapRun(r: any): PayrollRunView {
  return {
    id: r.id,
    periodMonth: r.period_month,
    status: r.status,
    workingDays: r.working_days,
    targetMinutes: r.target_minutes,
    monthClosedAt: r.month_closed_at,
    draftsComputedAt: r.drafts_computed_at,
    lockedAt: r.locked_at,
    paidAt: r.paid_at,
  };
}

function demoRuns(): PayrollRunView[] {
  return [{
    id: 'demo-run-2026-06',
    periodMonth: DEFAULT_PERIOD_MONTH,
    status: 'in_review',
    workingDays: 26,
    targetMinutes: 12488,
    monthClosedAt: null,
    draftsComputedAt: '2026-07-01T04:00:00Z',
    lockedAt: null,
    paidAt: null,
  }];
}

const RUN_FIELDS = `id, period_month, status, working_days, target_minutes,
  month_closed_at, drafts_computed_at, locked_at, paid_at`;

/** Every payroll run, newest month first. */
export async function getPayrollRuns(): Promise<PayrollRunView[]> {
  if (!isSupabaseConfigured()) return demoRuns();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payroll_runs')
    .select(RUN_FIELDS)
    .order('period_month', { ascending: false });
  if (error) fail('getPayrollRuns: could not load payroll runs', error);
  return (data ?? []).map(mapRun);
}

/** A single run by month, or null when that month has no run yet. */
export async function getPayrollRun(periodMonth: string): Promise<PayrollRunView | null> {
  const { start } = monthRange(periodMonth);
  if (!isSupabaseConfigured()) {
    return demoRuns().find((r) => r.periodMonth === start) ?? null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payroll_runs')
    .select(RUN_FIELDS)
    .eq('period_month', start)
    .maybeSingle();
  if (error) fail('getPayrollRun: could not load the payroll run', error);
  return data ? mapRun(data) : null;
}

// --------------------------------------------------------------- branches ---
export interface BranchRow {
  id: string;
  name: string;
  state: string;
}

function demoBranches(): BranchRow[] {
  return [
    { id: 'demo-pune', name: 'Pune', state: 'Maharashtra' },
    { id: 'demo-vadodara', name: 'Vadodara', state: 'Gujarat' },
  ];
}

/** All branches, alphabetical. */
export async function getBranches(): Promise<BranchRow[]> {
  if (!isSupabaseConfigured()) return demoBranches();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, state')
    .order('name');
  if (error) fail('getBranches: could not load branches', error);
  return (data ?? []).map((b: any) => ({ id: b.id, name: b.name, state: b.state }));
}

// ------------------------------------------------------------ today board ---
function demoTodayBoard(): TodayKpis {
  // The prototype's dashboard figures, kept verbatim.
  return {
    headcount: 45,
    present: 42,
    inOffice: 38,
    field: 4,
    absent: 3,
    byBranch: [
      { branch: 'Pune', count: 30 },
      { branch: 'Vadodara', count: 15 },
    ],
  };
}

/** Today's headcount / attendance KPIs, aggregated from v_today_board. */
export async function getTodayBoard(): Promise<TodayKpis> {
  if (!isSupabaseConfigured()) return demoTodayBoard();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_today_board')
    .select('branch, headcount, present, field, absent')
    .order('branch');
  if (error) fail('getTodayBoard: could not load the today board', error);

  const rows = data ?? [];
  const sum = (k: string) => rows.reduce((a: number, r: any) => a + Number(r[k] ?? 0), 0);
  // The view's `present` counts P/LM (in office); field duty (S/T) is separate.
  // "Present today" is everyone accounted for at work = in office + on field.
  const inOffice = sum('present');
  const field = sum('field');
  return {
    headcount: sum('headcount'),
    present: inOffice + field,
    inOffice,
    field,
    absent: sum('absent'),
    byBranch: rows.map((r: any) => ({ branch: r.branch, count: Number(r.headcount ?? 0) })),
  };
}

// ---------------------------------------------------------- punch log ---
function demoPunchLog(): PunchLogRow[] {
  const nul = (v: string) => (v === '—' ? null : v);
  return PUNCH_LOG.map((r) => ({
    code: r[0], name: r[1], branch: r[2],
    in: nul(r[3]), out: nul(r[4]), active: nul(r[5]),
    status: r[6],
  }));
}

/** Today's punch log, earliest punch first. */
export async function getPunchLogToday(): Promise<PunchLogRow[]> {
  if (!isSupabaseConfigured()) return demoPunchLog();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attendance_days')
    .select('status, punch_in, punch_out, worked_minutes, employees(code, full_name, branches(name))')
    .eq('work_date', todayISO());
  if (error) fail('getPunchLogToday: could not load today\'s attendance', error);

  const nowMinutes = (() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());
    const [h, m] = parts.split(':');
    return Number(h) * 60 + Number(m);
  })();

  return (data ?? [])
    .map((d: any): PunchLogRow => {
      const punchIn = trimTime(d.punch_in);
      const punchOut = trimTime(d.punch_out);
      let active: string | null = null;
      if (d.worked_minutes) {
        active = hoursMinutes(d.worked_minutes);
      } else if (punchIn && !punchOut) {
        // Still on the clock — show elapsed time since the punch-in.
        const [h, m] = punchIn.split(':');
        const elapsed = nowMinutes - (Number(h) * 60 + Number(m));
        if (elapsed > 0) active = hoursMinutes(elapsed);
      }
      return {
        code: d.employees?.code ?? '',
        name: d.employees?.full_name ?? '',
        branch: d.employees?.branches?.name ?? '',
        in: punchIn,
        out: punchOut,
        active,
        status: d.status,
      };
    })
    .sort((a, b) => (a.in ?? '99:99').localeCompare(b.in ?? '99:99'));
}

// ------------------------------------------------------------ celebrations ---
function demoCelebrations(): Celebration[] {
  return CELEBRATIONS.map((c, i) => {
    const [branch, department] = c.meta.split(' · ');
    const years = Number(c.note.match(/^(\d+)\s+year/)?.[1] ?? 0);
    return {
      id: `demo-cel-${i}`,
      name: c.name,
      branch,
      department: department ?? null,
      kind: c.note === 'birthday' ? 'birthday' : 'anniversary',
      years,
    };
  });
}

/** Today's birthdays and work anniversaries, from v_celebrations. */
export async function getCelebrationsToday(): Promise<Celebration[]> {
  if (!isSupabaseConfigured()) return demoCelebrations();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_celebrations')
    .select('id, full_name, branch, department, kind, years');
  if (error) fail('getCelebrationsToday: could not load celebrations', error);

  return (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.full_name,
    branch: c.branch,
    department: c.department,
    kind: c.kind,
    years: Number(c.years ?? 0),
  }));
}

// --------------------------------------------------------------- activity ---
export interface ActivityRow {
  id: string;
  when: string;
  message: string;
}

function demoActivity(limit: number): ActivityRow[] {
  return ACTIVITY.slice(0, limit).map((a, i) => ({
    id: `demo-activity-${i}`,
    when: a.when,
    message: stripTags(a.html),
  }));
}

/** The dashboard activity feed, newest first. */
export async function getActivityFeed(limit = 20): Promise<ActivityRow[]> {
  if (!isSupabaseConfigured()) return demoActivity(limit);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, message, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) fail('getActivityFeed: could not load the activity feed', error);

  return (data ?? []).map((a: any) => ({
    id: a.id,
    when: clockTime(a.occurred_at),
    message: a.message,
  }));
}

// ------------------------------------------------- employee self-service ---

/** One employee's day strip for a month. */
export async function getMyAttendance(
  employeeId: string,
  periodMonth: string = DEFAULT_PERIOD_MONTH,
): Promise<DayCell[]> {
  if (!isSupabaseConfigured()) return demoDayCells(DATA.employees[0]);

  const { start, end } = monthRange(periodMonth);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attendance_days')
    .select('work_date, status, punch_in, punch_out, worked_minutes')
    .eq('employee_id', employeeId)
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date');
  if (error) fail('getMyAttendance: could not load attendance', error);

  return (data ?? []).map((d: any) => ({
    day: Number(d.work_date.slice(8, 10)),
    status: d.status,
    in: trimTime(d.punch_in),
    out: trimTime(d.punch_out),
    hours: d.worked_minutes ? minutesToHHMM(d.worked_minutes) : null,
    isWeekOff: d.status === 'WO',
  }));
}

/** One employee's payslips, newest month first. */
export async function getMyPayslips(employeeId: string): Promise<PayslipRow[]> {
  if (!isSupabaseConfigured()) return demoPayslips().slice(0, 1);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payslips')
    .select(
      `${PAYSLIP_FIELDS}, payroll_runs(period_month),
       employees(code, full_name, branches(name, state))`,
    )
    .eq('employee_id', employeeId);
  if (error) fail('getMyPayslips: could not load payslips', error);

  return (data ?? [])
    .sort((a: any, b: any) =>
      String(b.payroll_runs?.period_month ?? '').localeCompare(
        String(a.payroll_runs?.period_month ?? ''),
      ),
    )
    .map(mapPayslip);
}

/** One employee's leave / duty requests, newest first. */
export async function getMyRequests(employeeId: string): Promise<RequestView[]> {
  if (!isSupabaseConfigured()) return DEMO_REQUESTS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('requests')
    .select(
      `id, type, leave_kind, start_date, end_date, days, reason, status, balance_after, created_at,
       employees(code, full_name, branches(name))`,
    )
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) fail('getMyRequests: could not load requests', error);
  return (data ?? []).map(mapRequest);
}

/** One employee's helpdesk tickets, newest first. */
const TICKET_COLS = 'id, subject, body, category, status, created_at, resolution_note, employees(code, full_name)';
const TICKET_COLS_LEGACY = 'id, subject, body, category, status, created_at, employees(code, full_name)';

export async function getMyTickets(employeeId: string): Promise<TicketView[]> {
  if (!isSupabaseConfigured()) return DEMO_TICKETS;

  const supabase = await createClient();
  let res = await supabase
    .from('helpdesk_tickets')
    .select(TICKET_COLS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  // Migration 0018 (resolution_note) not applied yet → retry without the column.
  if (res.error?.code === '42703') {
    res = (await supabase
      .from('helpdesk_tickets')
      .select(TICKET_COLS_LEGACY)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })) as typeof res;
  }
  if (res.error) fail('getMyTickets: could not load tickets', res.error);
  return (res.data ?? []).map(mapTicket);
}

// --------------------------------------------------------- leave balances ---
export interface LeaveBalanceRow {
  type: LeaveType;
  balance: number;
}

function demoLeaveBalances(): LeaveBalanceRow[] {
  return [
    { type: 'PL', balance: 12 },
    { type: 'CL', balance: 6 },
    { type: 'SL', balance: 6 },
    { type: 'LWP', balance: 0 },
  ];
}

/** An employee's leave balances for the current year. */
export async function getLeaveBalances(employeeId: string): Promise<LeaveBalanceRow[]> {
  if (!isSupabaseConfigured()) return demoLeaveBalances();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leave_balances')
    .select('type, balance')
    .eq('employee_id', employeeId)
    .eq('year', Number(todayISO().slice(0, 4)))
    .order('type');
  if (error) fail('getLeaveBalances: could not load leave balances', error);
  return (data ?? []).map((b: any) => ({ type: b.type, balance: Number(b.balance) }));
}

// ------------------------------------------------------- employee code map ---
/** employees.code -> employees.id, for the Excel importer. */
export async function getEmployeeCodeMap(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured()) {
    return Object.fromEntries(DATA.employees.map((e) => [e.code, e.code]));
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from('employees').select('id, code');
  if (error) fail('getEmployeeCodeMap: could not load employees', error);
  return Object.fromEntries((data ?? []).map((e: any) => [e.code, e.id]));
}

// ------------------------------------------------------------- employees ---
export interface EmployeeListRow {
  code: string; name: string; branch: string; gender: string;
  doj: string; gross: number; uan: string; esic_no: string | null;
  active: boolean;
}

function demoEmployees(): EmployeeListRow[] {
  return DATA.employees.map((e) => ({
    code: e.code, name: e.name, branch: e.branch, gender: e.gender,
    doj: e.doj, gross: e.gross, uan: e.uan, esic_no: e.esic_no, active: true,
  }));
}

/** Employee roster. Active-only by default; pass includeInactive to also return
 *  deactivated employees (so the UI can offer a "reactivate"). */
export async function getEmployees(includeInactive = false): Promise<EmployeeListRow[]> {
  if (!isSupabaseConfigured()) return demoEmployees();

  const supabase = await createClient();
  let query = supabase
    .from('employees')
    .select('code, full_name, gender, date_of_joining, gross_monthly, pf_uan, esic_number, status, branches(name)');
  if (!includeInactive) query = query.eq('status', 'active');
  const { data, error } = await query.order('code');
  if (error) fail('getEmployees: could not load employees', error);
  return (data ?? []).map((e: any) => ({
    code: e.code, name: e.full_name, branch: e.branches?.name ?? '', gender: e.gender,
    doj: e.date_of_joining, gross: Number(e.gross_monthly), uan: e.pf_uan, esic_no: e.esic_number,
    active: e.status === 'active',
  }));
}

// -------------------------------------------------------- notifications ---
export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * The signed-in user's notifications, newest first. RLS (0012) restricts this to
 * `recipient_id = auth.uid()`, so no caller-supplied id is needed or accepted.
 */
export async function getMyNotifications(limit = 20): Promise<NotificationRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) {
      warnNotMigrated('getMyNotifications', 'migration 0012_notifications.sql');
      return [];
    }
    fail('getMyNotifications: could not load notifications', error);
  }
  return (data ?? []).map((n: any) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

/** Unread count for the topbar badge. */
export async function getUnreadNotificationCount(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) {
    if (isMissingTable(error)) return 0;
    return 0; // the badge must never break the shell
  }
  return count ?? 0;
}

// ------------------------------------------------------- week-off policy ---
/**
 * The scheduled week-off rule (settings-driven, migration 0010). Falls back to
 * the documented default — Sundays off, Saturdays off except the 2nd and 4th —
 * whenever the settings are absent or unreadable, so the register never loses
 * its week-off columns over a missing row.
 */
export async function getWeekOffPolicy(): Promise<WeekOffPolicy> {
  if (!isSupabaseConfigured()) return DEFAULT_WEEK_OFF_POLICY;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['week_off_weekdays', 'working_saturdays']);
  if (error || !data) return DEFAULT_WEEK_OFF_POLICY;

  const byKey = new Map(data.map((r: any) => [r.key, r.value]));
  return policyFromSettings(byKey.get('week_off_weekdays'), byKey.get('working_saturdays'));
}

// -------------------------------------------------- employee pick options ---
export interface EmployeeOption {
  id: string;
  code: string;
  name: string;
}

/** Active employees as {id, code, name} — for "link this login to an employee". */
export async function getEmployeeOptions(): Promise<EmployeeOption[]> {
  if (!isSupabaseConfigured()) {
    return DATA.employees.map((e) => ({ id: e.code, code: e.code, name: e.name }));
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, code, full_name')
    .eq('status', 'active')
    .order('code');
  if (error) fail('getEmployeeOptions: could not load employees', error);
  return (data ?? []).map((e: any) => ({ id: e.id, code: e.code, name: e.full_name }));
}

// --------------------------------------------------------- reimbursements ---
export interface ReimbursementView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  claimDate: string;
  description: string;
  purpose: 'travel' | 'material_purchase' | 'other';
  sourceMedium: string | null;
  kms: number | null;
  modeOfPayment: string | null;
  amount: number;
  remarks: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  createdAt: string;
}

const REIMBURSEMENT_FIELDS = `id, employee_id, claim_date, description, purpose, source_medium,
  kms, mode_of_payment, amount, remarks, status, created_at,
  employees(code, full_name)`;

function mapReimbursement(r: any): ReimbursementView {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employees?.full_name ?? '',
    employeeCode: r.employees?.code ?? '',
    claimDate: String(r.claim_date).slice(0, 10),
    description: r.description,
    purpose: r.purpose,
    sourceMedium: r.source_medium,
    kms: r.kms === null || r.kms === undefined ? null : Number(r.kms),
    modeOfPayment: r.mode_of_payment,
    amount: Number(r.amount),
    remarks: r.remarks,
    status: r.status,
    createdAt: r.created_at,
  };
}

/** Every claim, newest first — the staff review queue. */
export async function getReimbursements(): Promise<ReimbursementView[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .select(REIMBURSEMENT_FIELDS)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) {
      warnNotMigrated('getReimbursements', 'migration 0009_reimbursements_compoff_sweep.sql');
      return [];
    }
    fail('getReimbursements: could not load claims', error);
  }
  return (data ?? []).map(mapReimbursement);
}

/** One employee's own claims, newest first. */
export async function getMyReimbursements(employeeId: string): Promise<ReimbursementView[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .select(REIMBURSEMENT_FIELDS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) {
      warnNotMigrated('getMyReimbursements', 'migration 0009_reimbursements_compoff_sweep.sql');
      return [];
    }
    fail('getMyReimbursements: could not load claims', error);
  }
  return (data ?? []).map(mapReimbursement);
}

/** The ₹/km rate used to auto-calculate travel claims (settings-driven). */
export async function getReimbursementRate(): Promise<number> {
  const FALLBACK = 3.5;
  if (!isSupabaseConfigured()) return FALLBACK;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'reimbursement_rate_per_km')
    .maybeSingle<{ value: unknown }>();
  if (error || !data) return FALLBACK;
  const n = Number(data.value);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK;
}

// ------------------------------------------------------------- comp offs ---
export interface CompOffRow {
  id: string;
  employeeId: string;
  earnedDate: string;
  status: 'available' | 'applied' | 'used' | 'expired';
  usedDate: string | null;
}

/**
 * Comp-off credits already granted for a month, so the register can tell an
 * un-granted eligible day from one that has already been credited.
 * Keyed by `${employeeId}|${earnedDate}` at the callsite.
 */
export async function getCompOffsForMonth(
  periodMonth: string = DEFAULT_PERIOD_MONTH,
): Promise<CompOffRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { start, end } = monthRange(periodMonth);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('comp_offs')
    .select('id, employee_id, earned_date, status, used_date')
    .gte('earned_date', start)
    .lte('earned_date', end);
  if (error) {
    if (isMissingTable(error)) {
      warnNotMigrated('getCompOffsForMonth', 'migration 0009_reimbursements_compoff_sweep.sql');
      return [];
    }
    fail('getCompOffsForMonth: could not load comp offs', error);
  }
  return (data ?? []).map((c: any) => ({
    id: c.id,
    employeeId: c.employee_id,
    earnedDate: String(c.earned_date).slice(0, 10),
    status: c.status,
    usedDate: c.used_date ? String(c.used_date).slice(0, 10) : null,
  }));
}

/** One employee's comp-off credits, newest earned first. */
export async function getMyCompOffs(employeeId: string): Promise<CompOffRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('comp_offs')
    .select('id, employee_id, earned_date, status, used_date')
    .eq('employee_id', employeeId)
    .order('earned_date', { ascending: false });
  if (error) {
    if (isMissingTable(error)) {
      warnNotMigrated('getMyCompOffs', 'migration 0009_reimbursements_compoff_sweep.sql');
      return [];
    }
    fail('getMyCompOffs: could not load comp offs', error);
  }
  return (data ?? []).map((c: any) => ({
    id: c.id,
    employeeId: c.employee_id,
    earnedDate: String(c.earned_date).slice(0, 10),
    status: c.status,
    usedDate: c.used_date ? String(c.used_date).slice(0, 10) : null,
  }));
}

/** Full editable fields for one employee, keyed by code. Null when not found. */
export interface EmployeeEditRow {
  code: string;
  full_name: string;
  branch: string;
  gender: string;
  date_of_joining: string;
  date_of_birth: string | null;
  whatsapp: string | null;
  pan: string | null;
  pf_uan: string | null;
  esic_number: string | null;
  gross_monthly: number;
  basic_da: number;
  hra: number;
  special_allowance: number;
}

export async function getEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  if (!isSupabaseConfigured()) {
    const e = DATA.employees.find((x) => x.code === code);
    if (!e) return null;
    // Demo rows carry no salary split — synthesise the usual 50/30/20 structure.
    const gross = e.gross;
    const basic = Math.round(gross * 0.5);
    const hra = Math.round(gross * 0.3);
    return {
      code: e.code, full_name: e.name, branch: e.branch, gender: e.gender,
      date_of_joining: e.doj, date_of_birth: null, whatsapp: null, pan: null,
      pf_uan: e.uan, esic_number: e.esic_no,
      gross_monthly: gross, basic_da: basic, hra, special_allowance: gross - basic - hra,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select(
      `code, full_name, gender, date_of_joining, date_of_birth, whatsapp, pan, pf_uan, esic_number,
       gross_monthly, basic_da, hra, special_allowance, branches(name)`,
    )
    .eq('code', code)
    .maybeSingle();
  if (error) fail('getEmployeeForEdit: could not load employee', error);
  if (!data) return null;
  const e: any = data;
  return {
    code: e.code,
    full_name: e.full_name,
    branch: e.branches?.name ?? '',
    gender: e.gender,
    date_of_joining: e.date_of_joining,
    date_of_birth: e.date_of_birth,
    whatsapp: e.whatsapp,
    pan: e.pan,
    pf_uan: e.pf_uan,
    esic_number: e.esic_number,
    gross_monthly: Number(e.gross_monthly),
    basic_da: Number(e.basic_da),
    hra: Number(e.hra),
    special_allowance: Number(e.special_allowance),
  };
}

// ---------------------------------------------------- employee overview ---
export interface EmployeeOverview {
  name: string;
  code: string;
  branch: string;
  present: number;
  halfDays: number;
  leaves: number;
  workedHours: string;
  netPay: number | null;
}

export async function getEmployeeOverview(
  employeeId: string | null,
  fallbackName?: string | null,
  periodMonth: string = DEFAULT_PERIOD_MONTH,
): Promise<EmployeeOverview> {
  const demo = (): EmployeeOverview => {
    const e = DATA.employees.find((x) => x.name === fallbackName) ?? DATA.employees[0];
    return {
      name: e.name, code: e.code, branch: e.branch,
      present: e.sum.P, halfDays: e.sum.HD, leaves: e.sum.L,
      workedHours: e.worked, netPay: e.pay.net,
    };
  };
  if (!isSupabaseConfigured()) return demo();

  // No linked employee record is a real state (e.g. a staff login), not an error.
  if (!employeeId) {
    return {
      name: fallbackName ?? '', code: '', branch: '',
      present: 0, halfDays: 0, leaves: 0, workedHours: '00:00', netPay: null,
    };
  }

  const { start, end } = monthRange(periodMonth);
  const supabase = await createClient();

  const { data: emp, error: empError } = await supabase
    .from('employees')
    .select('code, full_name, branches(name)')
    .eq('id', employeeId)
    .maybeSingle();
  if (empError) fail('getEmployeeOverview: could not load the employee', empError);
  if (!emp) throw new Error(`getEmployeeOverview: no employee with id ${employeeId}`);

  const { data: days, error: daysError } = await supabase
    .from('attendance_days')
    .select('status, worked_minutes')
    .eq('employee_id', employeeId)
    .gte('work_date', start)
    .lte('work_date', end);
  if (daysError) fail('getEmployeeOverview: could not load attendance', daysError);

  const rows = days ?? [];
  const count = (s: string) => rows.filter((d: any) => d.status === s).length;
  const workedMin = rows.reduce((a: number, d: any) => a + (d.worked_minutes ?? 0), 0);

  const { data: slip, error: slipError } = await supabase
    .from('payslips')
    .select('net_payable, payroll_runs!inner(period_month)')
    .eq('employee_id', employeeId)
    .eq('payroll_runs.period_month', start)
    .maybeSingle();
  if (slipError) fail('getEmployeeOverview: could not load the payslip', slipError);

  return {
    name: (emp as any).full_name,
    code: (emp as any).code,
    branch: (emp as any).branches?.name ?? '',
    present: count('P'), halfDays: count('HD'), leaves: count('L'),
    workedHours: minutesToHHMM(workedMin),
    netPay: slip ? Number((slip as any).net_payable) : null,
  };
}

// -------------------------------------------------------------- policies ---
export interface PolicyView {
  id: string;
  title: string;
  category: string | null;
  version: number;
  effective_date: string | null;
  body: string;
  published: boolean;
  acknowledged: boolean;
}

function demoPolicies(): PolicyView[] {
  return DEMO_POLICIES.map((p) => ({
    id: p.id, title: p.title, category: p.category, version: p.version,
    effective_date: p.effective_date, body: p.body, published: true, acknowledged: false,
  }));
}

/** Published policies for an employee, flagged with whether they've acknowledged. */
export async function getEmployeePolicies(employeeId: string | null): Promise<PolicyView[]> {
  if (!isSupabaseConfigured()) return demoPolicies();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('policies')
    .select('id, title, category, version, effective_date, body, published')
    .eq('published', true)
    .order('category');
  if (error) fail('getEmployeePolicies: could not load policies', error);

  let acked = new Set<string>();
  if (employeeId) {
    const { data: acks, error: acksError } = await supabase
      .from('policy_acknowledgements')
      .select('policy_id')
      .eq('employee_id', employeeId);
    if (acksError) fail('getEmployeePolicies: could not load acknowledgements', acksError);
    acked = new Set((acks ?? []).map((a: any) => a.policy_id));
  }
  return (data ?? []).map((p: any) => ({ ...p, acknowledged: acked.has(p.id) }));
}

/** All policies for the admin management screen. */
export async function getAllPolicies(): Promise<Policy[]> {
  if (!isSupabaseConfigured()) {
    return demoPolicies().map((p) => ({
      id: p.id, title: p.title, category: p.category, body: p.body, version: p.version,
      effective_date: p.effective_date, branch_id: null, published: p.published,
      created_by: null, created_at: '', updated_at: '',
    }));
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('policies')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) fail('getAllPolicies: could not load policies', error);
  return (data ?? []) as Policy[];
}

// --------------------------------------------------------------- holidays ---
export interface HolidayView {
  id: string;
  date: string;
  name: string;
  branch: string | null; // branch null = all branches
}

/** Company holidays, sorted ascending by date. */
export async function getHolidays(): Promise<HolidayView[]> {
  if (!isSupabaseConfigured()) return DEMO_HOLIDAYS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('holidays')
    .select('id, holiday_date, name, branches(name)')
    .order('holiday_date', { ascending: true });
  if (error) fail('getHolidays: could not load holidays', error);
  return (data ?? []).map((h: any) => ({
    id: h.id,
    date: h.holiday_date,
    name: h.name,
    branch: h.branches?.name ?? null,
  }));
}

// ---------------------------------------------------------------- notices ---
export interface NoticeView {
  id: string;
  title: string;
  body: string | null;
  channel: 'app' | 'whatsapp' | 'both';
  branch: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
}

/** Notices, newest first. */
export async function getNotices(): Promise<NoticeView[]> {
  if (!isSupabaseConfigured()) return DEMO_NOTICES;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notices')
    .select('id, title, body, channel, published_at, created_at, branches(name)')
    .order('created_at', { ascending: false });
  if (error) fail('getNotices: could not load notices', error);
  return (data ?? []).map((n: any) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    channel: n.channel,
    branch: n.branches?.name ?? null,
    published: n.published_at != null,
    publishedAt: n.published_at,
    createdAt: n.created_at,
  }));
}

/** The ids of notices this employee has marked read (for the dashboard). */
export async function getReadNoticeIds(employeeId: string | null): Promise<string[]> {
  if (!employeeId || !isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notice_reads')
    .select('notice_id')
    .eq('employee_id', employeeId);
  if (error) {
    // Only the pre-migration case (table absent) is benign → treat all as unread.
    // A real error (RLS/permission/network) must surface, not be swallowed.
    if (isMissingTable(error)) return [];
    fail('getReadNoticeIds: could not load read receipts', error);
  }
  return (data ?? []).map((r: { notice_id: string }) => r.notice_id);
}

/**
 * Best-effort: hard-delete notices older than 30 days (published 30d ago, or a
 * draft created 30d ago). Called from the staff Notices page so the table is
 * cleaned even without pg_cron; employees never see expired notices regardless
 * (the dashboard filters them out). Staff hold the delete grant; errors are
 * swallowed so a cleanup hiccup never breaks the page.
 */
export async function purgeExpiredNotices(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const supabase = await createClient();
    await supabase
      .from('notices')
      .delete()
      .or(`published_at.lt.${cutoff},and(published_at.is.null,created_at.lt.${cutoff})`);
  } catch {
    // ignore — this is opportunistic cleanup, not required for correctness
  }
}

// --------------------------------------------------------------- helpdesk ---
export interface TicketView {
  id: string;
  subject: string;
  body: string | null;
  category: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  employeeName: string | null;
  employeeCode: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

function mapTicket(t: any): TicketView {
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    category: t.category,
    status: t.status,
    employeeName: t.employees?.full_name ?? null,
    employeeCode: t.employees?.code ?? null,
    resolutionNote: t.resolution_note ?? null,
    createdAt: t.created_at,
  };
}

/** Helpdesk tickets, open first then newest. */
export async function getTickets(): Promise<TicketView[]> {
  if (!isSupabaseConfigured()) return DEMO_TICKETS;

  const supabase = await createClient();
  let res = await supabase
    .from('helpdesk_tickets')
    .select(TICKET_COLS)
    .order('created_at', { ascending: false });
  if (res.error?.code === '42703') {
    res = (await supabase
      .from('helpdesk_tickets')
      .select(TICKET_COLS_LEGACY)
      .order('created_at', { ascending: false })) as typeof res;
  }
  if (res.error) fail('getTickets: could not load tickets', res.error);
  // Open tickets first, otherwise preserve newest-first ordering.
  return (res.data ?? [])
    .map(mapTicket)
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
}

// --------------------------------------------------------------- settings ---
export interface SettingView {
  key: string;
  value: unknown;
  label: string | null;
  description: string | null;
}

/** App settings. */
export async function getSettings(): Promise<SettingView[]> {
  if (!isSupabaseConfigured()) return DEMO_SETTINGS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('key, value, label, description')
    .order('key');
  if (error) fail('getSettings: could not load settings', error);
  return (data ?? []).map((s: any) => ({
    key: s.key,
    value: s.value,
    label: s.label,
    description: s.description,
  }));
}

// --------------------------------------------------------------- requests ---
export interface RequestView {
  id: string;
  employeeName: string;
  employeeCode: string;
  branch: string;
  type: RequestType;
  leaveKind: string | null;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  balanceAfter: number | null;
}

function mapRequest(r: any): RequestView {
  return {
    id: r.id,
    employeeName: r.employees?.full_name ?? '',
    employeeCode: r.employees?.code ?? '',
    branch: r.employees?.branches?.name ?? '',
    type: r.type,
    leaveKind: r.leave_kind,
    startDate: r.start_date,
    endDate: r.end_date,
    days: Number(r.days),
    reason: r.reason,
    status: r.status,
    balanceAfter: r.balance_after != null ? Number(r.balance_after) : null,
  };
}

/** Leave / duty requests, pending first then reviewed. */
export async function getRequests(): Promise<RequestView[]> {
  if (!isSupabaseConfigured()) return DEMO_REQUESTS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('requests')
    .select(
      `id, type, leave_kind, start_date, end_date, days, reason, status, balance_after, created_at,
       employees(code, full_name, branches(name))`,
    )
    .order('created_at', { ascending: false });
  if (error) fail('getRequests: could not load requests', error);
  // Pending first, otherwise preserve newest-first ordering.
  return (data ?? [])
    .map(mapRequest)
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
}
