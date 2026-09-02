// ============================================================================
// Data access layer. These run in Server Components.
//
// THE ONE RULE — read before editing:
//   When a query fails, the error is THROWN, not swallowed. A broken database
//   must never be indistinguishable from a working one.
//
//   const { data, error } = await ...;
//   if (error) fail('context', error);                 // surface it
//   return map(data);
//
// A legitimately empty result (no payroll run for the month yet) returns an
// empty array — that is an empty state, not an error.
// ============================================================================
import type { TabAccess } from '@/lib/access';
import { createClient } from '@/lib/db/server';
import { minutesToHHMM, trimTime } from '@/lib/format';
import { isMongoConfigured } from '@/lib/db/mongo';
import {
  DEFAULT_WEEK_OFF_POLICY,
  policyFromSettings,
  type WeekOffPolicy,
} from '@/lib/week-off';
import { PRESENT_CREDIT } from '@/lib/leave-salary';
import type { TopbarStats } from '@/lib/constants';
import { REQUIRED_DOCUMENT_CATEGORIES } from '@/lib/constants';
import type {
  RegisterEmployee, PayslipRow, DayCell, TodayKpis, Celebration, PunchLogRow,
} from '@/types/domain';
import type { Policy, LeaveType, RequestType } from '@/types/database';
import {
  COLLECTIONS,
  type BranchDoc,
  type DepartmentDoc,
  type EmployeeDoc,
  type UserDoc,
} from '@/lib/db/collections';
import { afterParentCheck, NotSignedInError, scoped } from '@/lib/db/repo';
import { toNumber } from '@/lib/db/money';
import { deleteExpiredNotices } from '@/lib/db/scheduler';

// Re-exported: ~8 action files already import isMongoConfigured from here.
// The implementation lives in @/lib/db/mongo (single source of truth).
export { isMongoConfigured };

// ------------------------------------------------------------------ utils ---

/**
 * A BSON Date as the ISO string the view layer expects.
 *
 * Postgres returned timestamptz already serialised; the driver returns a real
 * Date. Every mapper that used to pass a timestamp straight through goes via
 * this, so a Date never reaches a client component (React cannot serialise one
 * across the boundary without turning it back into a string anyway).
 *
 * Calendar days do NOT come through here — they are stored as strings on
 * purpose and are already in the right shape.
 */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return (value as string | null) ?? '';
}

/**
 * The same, but null stays null.
 *
 * Use wherever the target field is nullable — a read_at, a published_at.
 * Flattening those to '' would make "never read" render as an empty date
 * instead of being absent, and `publishedAt != null` checks would start
 * returning true for unpublished rows.
 */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

/**
 * First day of the CURRENT month in IST — the default period everywhere.
 * Evaluated at call time (it is used as a default parameter below), so a
 * long-running server crosses month boundaries correctly. Replaces the
 * prototype-era hardcoded '2026-06-01', which pinned /payroll, /today and
 * /me to June 2026 forever.
 */
export function currentPeriodMonth(): string {
  return todayISO().slice(0, 8) + '01';
}

interface QueryError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

/**
 * Turn a query error into a real, debuggable Error and throw it. The query
 * layer reports failures as plain objects; throwing one raw loses the stack and
 * renders as "{}" in Next's error overlay.
 */
function fail(context: string, error: QueryError): never {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
  const code = error.code ? ` (${error.code})` : '';
  throw new Error(`${context}: ${detail}${code}`);
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

// `id` is the payslip's own uuid and must stay selected: it keys the adjustments
// lookup and is the value posted back by saveAdjustments. It was missing here,
// which left mapPayslip's `?? p.id` fallback permanently undefined.
// The adjustments embed is selected with `*` on purpose: 0041 adds
// other_deductions, and naming it here would 42703 the whole payslip query on a
// database where that migration is still pending. `*` returns whatever columns
// exist and mapPayslip defaults the rest to 0.
const PAYSLIP_FIELDS = `id, payable_days, earned_gross, shortfall_amount, per_day_rate,
  basic_earned, hra_earned, special_earned, pf_employee, pf_employer, esic_employee,
  esic_employer, professional_tax, net_payable, shortfall_minutes, payslip_adjustments(*)`;

function mapPayslip(p: any): PayslipRow {
  // The 1:1 embed's shape (object vs single-element array) depends on how the
  // relationship is declared — accept both, and null when no row exists.
  const adj = Array.isArray(p.payslip_adjustments)
    ? p.payslip_adjustments[0]
    : p.payslip_adjustments;
  return {
    // The payslip uuid — NOT employees.code, which is what `code` below is for.
    // Handing back the code sent employee codes into `payslip_adjustments.id`
    // (a uuid column), so the payroll page died on 22P02 as soon as a run had
    // payslips; it also collided React keys on /me, where every row of one
    // employee's payslip history shares the same code.
    id: p.id,
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
    advanceRecovery: Number(adj?.advance_recovery ?? 0),
    lossDamage: Number(adj?.loss_damage ?? 0),
    otherDeductions: Number(adj?.other_deductions ?? 0),
    lastMonthBalance: Number(adj?.last_month_balance ?? 0),
    reimbursementBonus: Number(adj?.reimbursement_bonus ?? 0),
    bonus: Number(adj?.bonus ?? 0),
  };
}

// --------------------------------------------------------------- register ---
export async function getRegister(
  periodMonth: string = currentPeriodMonth(),
  branch?: string | null,
): Promise<RegisterEmployee[]> {
  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();

  // Branch scoping: resolve the branch name to its id and filter on the FK, so
  // employees are actually excluded (filtering on an embedded column would only
  // null the join, not drop the parent row). Blank/absent branch = all branches.
  let branchId: string | null = null;
  if (branch) {
    const { data: b } = await dbc
      .from('branches')
      .select('id')
      .eq('name', branch)
      .maybeSingle<{ id: string }>();
    // Unknown branch name → no matches rather than silently showing everyone.
    branchId = b?.id ?? '__none__';
  }

  let employeeQuery = dbc
    .from('employees')
    .select('id, code, full_name, gender, date_of_joining, branches(name)')
    .eq('status', 'active')
    .order('code');
  if (branchId) employeeQuery = employeeQuery.eq('branch_id', branchId);

  const { data: employees, error } = await employeeQuery;
  if (error) fail('getRegister: could not load employees', error);
  if (!employees?.length) return [];

  const { data: days, error: daysError } = await dbc
    .from('attendance_days')
    .select('employee_id, work_date, status, punch_in, punch_out, worked_minutes')
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date');
  if (daysError) fail('getRegister: could not load attendance', daysError);

  // The run carries the month's target minutes; without one there is no target.
  const { data: run, error: runError } = await dbc
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
      // Week-offs come from the resolved status, not a hardcoded calendar.
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

// ----------------------------------------------- register reconciliation ---
export interface LeaveRegisterMismatch {
  employeeId: string;
  code: string;
  name: string;
  /** 'YYYY-MM-DD' of the approved-leave day the register does not reflect. */
  date: string;
  leaveKind: string | null;
  /** What the register shows instead of 'L' — 'AB', another code, or null (no row). */
  registerStatus: string | null;
}

/** Expand an inclusive ISO date span into 'YYYY-MM-DD' strings, clamped to a window. */
function isoDaysInRange(start: string, end: string, clampStart: string, clampEnd: string): string[] {
  const from = start < clampStart ? clampStart : start;
  const to = end > clampEnd ? clampEnd : end;
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= last.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Approved leave that the monthly register does not reflect.
 *
 * Approving a leave request (reviewRequest) only draws down leave_balances — it
 * never stamps attendance_days 'L'. So an approved leave and the register can
 * silently diverge: the employee is on sanctioned leave but the register shows
 * them Absent (or has no row). This surfaces exactly those days for review,
 * without mutating anything. Days already covered on the register (L / WO / OH /
 * CO / a present-style code) are NOT flagged — only genuine gaps ('AB' or no row).
 */
export async function getLeaveRegisterMismatches(
  periodMonth: string = currentPeriodMonth(),
  branch?: string | null,
): Promise<LeaveRegisterMismatch[]> {
  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();

  // Approved leave requests overlapping the month.
  const { data: reqs, error: reqErr } = await dbc
    .from('requests')
    .select('employee_id, leave_kind, start_date, end_date, employees(code, full_name, branch_id, branches(name))')
    .eq('type', 'leave')
    .eq('status', 'approved')
    .lte('start_date', end)
    .gte('end_date', start);
  if (reqErr) fail('getLeaveRegisterMismatches: could not load approved leave', reqErr);
  if (!reqs?.length) return [];

  // Register rows for the month, keyed employee|date.
  const { data: days, error: dayErr } = await dbc
    .from('attendance_days')
    .select('employee_id, work_date, status')
    .gte('work_date', start)
    .lte('work_date', end);
  if (dayErr) fail('getLeaveRegisterMismatches: could not load attendance', dayErr);

  const byKey = new Map<string, string>();
  for (const d of days ?? []) {
    byKey.set(`${(d as any).employee_id}|${(d as any).work_date}`, (d as any).status);
  }

  // Statuses that already account for the day — not a divergence.
  const COVERED = new Set(['L', 'WO', 'OH', 'CO']);

  const out: LeaveRegisterMismatch[] = [];
  for (const r of reqs as any[]) {
    if (branch && r.employees?.branches?.name !== branch) continue;
    for (const date of isoDaysInRange(r.start_date, r.end_date, start, end)) {
      const status = byKey.get(`${r.employee_id}|${date}`) ?? null;
      if (status && COVERED.has(status)) continue;
      out.push({
        employeeId: r.employee_id,
        code: r.employees?.code ?? '',
        name: r.employees?.full_name ?? '',
        date,
        leaveKind: r.leave_kind ?? null,
        registerStatus: status,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  return out;
}

// --------------------------------------------------------- e-signatures ---
export interface AcknowledgementRow {
  id: string;
  documentKind: string;
  documentId: string | null;
  signedName: string;
  signedAt: string;
}

/**
 * One employee's e-signatures (migration 0037 §4).
 *
 * Distinct from `policy_acknowledgements` (0004), which is a lightweight
 * read-receipt: these carry a typed name, a server-clock timestamp and the
 * request's IP, and are append-only evidence.
 */
export async function getMyAcknowledgements(employeeId: string): Promise<AcknowledgementRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('acknowledgements')
    .select('id, document_kind, document_id, signed_name, signed_at')
    .eq('employee_id', employeeId)
    .order('signed_at', { ascending: false });
  if (error) {
    fail('getMyAcknowledgements: could not load signatures', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    documentKind: r.document_kind,
    documentId: r.document_id,
    signedName: r.signed_name,
    signedAt: iso(r.signed_at),
  }));
}

// -------------------------------------------------------------- documents ---

/**
 * Where a document's file came from.
 *
 * 'issued' rows are the relieving / experience / F&F PDFs generateExitDocument
 * produces into the generated-documents bucket. They are already verified, they
 * are never replaced through the register, and 'experience' means a different
 * thing on one than on an upload — see GENERATED_DOCUMENT_CATEGORIES.
 */
export type DocumentSource = 'uploaded' | 'issued';

/**
 * What the register shows in its Status column.
 *
 *   awaiting   filed, not yet looked at
 *   returned   HR sent it back with a remark; the employee must replace it
 *   verified   accepted
 *   superseded a newer version exists — history, not a live document
 */
export type DocumentStatus = 'awaiting' | 'returned' | 'verified' | 'superseded';

export interface EmployeeDocumentRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  category: string | null;
  title: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  verifyRemark: string | null;
  source: DocumentSource;
  status: DocumentStatus;
  version: number;
  /** The first version's id — every version of one document shares it. */
  docGroup: string;
  supersededAt: string | null;
  /** True when this row is the live version. */
  isCurrent: boolean;
}

const DOCUMENT_FIELDS =
  'id, employee_id, category, title, uploaded_at, verified_at, verify_remark, bucket, ' +
  'doc_group, version, replaces_id, replaced_by_id, superseded_at, employees(code, full_name)';

function documentStatus(r: any): DocumentStatus {
  if (r.superseded_at) return 'superseded';
  if (r.verified_at) return 'verified';
  return r.verify_remark ? 'returned' : 'awaiting';
}

function mapDocument(r: any): EmployeeDocumentRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    code: r.employees?.code ?? '',
    name: r.employees?.full_name ?? '',
    category: r.category,
    title: r.title,
    uploadedAt: iso(r.uploaded_at),
    verifiedAt: isoOrNull(r.verified_at),
    verifyRemark: r.verify_remark,
    source: r.bucket === 'generated-documents' ? 'issued' : 'uploaded',
    status: documentStatus(r),
    // A row written before versioning existed carries none of these fields,
    // which is exactly "version 1, its own group, current" — so the defaults
    // here are the backfill, and no data migration is needed.
    version: Number(r.version ?? 1),
    docGroup: r.doc_group ?? r.id,
    supersededAt: isoOrNull(r.superseded_at),
    isCurrent: !r.superseded_at,
  };
}

/**
 * One employee's CURRENT documents, newest first. Never returns storage paths.
 *
 * Superseded versions are excluded: this feeds the employee's own dashboard,
 * where showing three copies of an ID proof they replaced twice is noise. The
 * staff drill-down uses getEmployeeDocumentHistory() to see everything.
 */
export async function getEmployeeDocuments(employeeId: string): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(DOCUMENT_FIELDS)
    .eq('employee_id', employeeId)
    .is('superseded_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) {
    fail('getEmployeeDocuments: could not load documents', error);
  }
  return (data ?? []).map(mapDocument);
}

/**
 * EVERY version of every document for one employee, newest first — the staff
 * drill-down. Superseded rows are included; `isCurrent` and `docGroup` are what
 * the panel groups on.
 */
export async function getEmployeeDocumentHistory(
  employeeId: string,
): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(DOCUMENT_FIELDS)
    .eq('employee_id', employeeId)
    .order('uploaded_at', { ascending: false });
  if (error) {
    fail('getEmployeeDocumentHistory: could not load the document history', error);
  }
  return (data ?? []).map(mapDocument);
}

/**
 * The register: the CURRENT version of every document, for every employee.
 *
 * Superseded rows are left out — the register is what the company holds now,
 * and history belongs behind the document it belongs to.
 */
export async function getDocumentRegister(): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(DOCUMENT_FIELDS)
    .is('superseded_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) {
    fail('getDocumentRegister: could not load the document register', error);
  }
  return (data ?? []).map(mapDocument);
}

/**
 * Documents awaiting HR verification, across everyone — the review queue.
 *
 * CURRENT versions only. A superseded row is unverified for ever by
 * definition — it was replaced before anyone got to it — and leaving those in
 * would grow the queue with work that can never be done.
 */
export async function getUnverifiedDocuments(): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(DOCUMENT_FIELDS)
    .is('verified_at', null)
    .is('superseded_at', null)
    .order('uploaded_at', { ascending: true });
  if (error) {
    fail('getUnverifiedDocuments: could not load the verification queue', error);
  }
  return (data ?? []).map(mapDocument);
}

export interface DocumentStats {
  /** Current documents on file, all employees. */
  total: number;
  awaiting: number;
  returned: number;
  /** HR-generated letters (relieving / experience / F&F). */
  issued: number;
  /**
   * Required categories not on file, summed over ACTIVE employees.
   *
   * Counts gaps, not people: an employee missing three of the four required
   * categories contributes three. `employeesMissing` is the headcount.
   */
  missing: number;
  employeesMissing: number;
}

/**
 * The KPI band on /documents.
 *
 * Derived from the register rather than counted with five round trips: the
 * register is already loaded for the table on the same request, but this is
 * exported separately so a caller that only wants the numbers does not have to
 * know that.
 */
export function documentStats(
  register: EmployeeDocumentRow[],
  activeEmployeeIds: string[],
): DocumentStats {
  let awaiting = 0, returned = 0, issued = 0;
  const heldByEmployee = new Map<string, Set<string>>();

  for (const d of register) {
    if (d.source === 'issued') issued++;
    if (d.status === 'awaiting') awaiting++;
    if (d.status === 'returned') returned++;
    // Only a VERIFIED upload counts as held: an unverified or returned scan is
    // exactly the gap the missing count is meant to surface.
    if (d.status === 'verified' && d.category) {
      let held = heldByEmployee.get(d.employeeId);
      if (!held) heldByEmployee.set(d.employeeId, (held = new Set()));
      held.add(d.category);
    }
  }

  let missing = 0, employeesMissing = 0;
  for (const id of activeEmployeeIds) {
    const held = heldByEmployee.get(id);
    const gaps = REQUIRED_DOCUMENT_CATEGORIES.filter((c) => !held?.has(c)).length;
    if (gaps > 0) employeesMissing++;
    missing += gaps;
  }

  return { total: register.length, awaiting, returned, issued, missing, employeesMissing };
}

// ------------------------------------------------------------- onboarding ---
export interface OnboardingTaskRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  title: string;
  assigneeRole: string | null;
  status: 'pending' | 'done' | 'blocked';
  dueDate: string | null;
}

export interface OnboardingTemplateRow {
  id: string;
  name: string;
  active: boolean;
  /** How many steps the template fans out into. */
  steps: number;
}

const ONBOARDING_TASK_FIELDS =
  'id, employee_id, title, assignee_role, status, due_date, employees(code, full_name)';

function mapOnboardingTask(r: any): OnboardingTaskRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    code: r.employees?.code ?? '',
    name: r.employees?.full_name ?? '',
    title: r.title,
    assigneeRole: r.assignee_role,
    status: r.status,
    dueDate: r.due_date,
  };
}

/**
 * Every joiner's onboarding tasks — the HR board.
 *
 * Ordered by due date so the most overdue work sorts to the top; nulls last,
 * because a task with no date is the one nobody has committed to yet and should
 * not outrank a step that is actually late.
 */
export async function getOnboardingBoard(): Promise<OnboardingTaskRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .select(ONBOARDING_TASK_FIELDS)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) {
    fail('getOnboardingBoard: could not load onboarding tasks', error);
  }
  return (data ?? []).map(mapOnboardingTask);
}

/** One employee's own checklist — the read-only card on /me. */
export async function getMyOnboardingTasks(employeeId: string): Promise<OnboardingTaskRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_tasks')
    .select(ONBOARDING_TASK_FIELDS)
    .eq('employee_id', employeeId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) {
    fail('getMyOnboardingTasks: could not load your onboarding checklist', error);
  }
  return (data ?? []).map(mapOnboardingTask);
}

/**
 * The reusable checklists, with their step count.
 *
 * `steps` comes from an embedded count rather than a second round-trip; a
 * template whose items are missing reads as 0 steps, which is exactly what the
 * "(0 steps)" label in the picker should say.
 */
export async function getOnboardingTemplates(): Promise<OnboardingTemplateRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('onboarding_templates')
    .select('id, name, active, onboarding_template_items(count)')
    .order('name');
  if (error) {
    fail('getOnboardingTemplates: could not load onboarding templates', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    steps: Number(r.onboarding_template_items?.[0]?.count ?? 0),
  }));
}

// ------------------------------------------------------------------ exits ---
export interface ExitCaseRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  stage: 'initiated' | 'clearance' | 'settlement' | 'completed';
  resignationDate: string | null;
  lastWorkingDay: string | null;
  reason: string | null;
  /** Outstanding counts from v_exit_clearance_pending. */
  assetsOutstanding: number;
  itemsOutstanding: number;
  clearanceItemsOpen: number;
  clearanceComplete: boolean;
  /** Settlement, when one has been prepared. */
  fnfStatus: 'draft' | 'approved' | 'paid' | null;
  fnfNetPayable: number | null;
}

/** Every exit case with its clearance and settlement state — the HR exits board. */
export async function getExitCases(): Promise<ExitCaseRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('exit_cases')
    .select(
      'id, employee_id, stage, resignation_date, last_working_day, reason, employees(code, full_name)',
    )
    .order('last_working_day', { ascending: false });
  if (error) {
    fail('getExitCases: could not load exit cases', error);
  }
  const cases = (data ?? []) as any[];
  if (cases.length === 0) return [];

  // The clearance view and the settlement are separate reads: a missing view
  // (migration not applied) must degrade to zeroes, not break the board.
  const [{ data: pending }, { data: fnfs }] = await Promise.all([
    dbc
      .from('v_exit_clearance_pending')
      .select('exit_case_id, assets_outstanding, items_outstanding, clearance_items_open, clearance_complete'),
    dbc.from('full_and_final').select('exit_case_id, status, net_payable'),
  ]);
  const byCase = new Map((pending ?? []).map((p: any) => [p.exit_case_id, p]));
  const fnfByCase = new Map((fnfs ?? []).map((f: any) => [f.exit_case_id, f]));

  return cases.map((c) => {
    const p = byCase.get(c.id);
    const f = fnfByCase.get(c.id);
    return {
      id: c.id,
      employeeId: c.employee_id,
      code: c.employees?.code ?? '',
      name: c.employees?.full_name ?? '',
      stage: c.stage,
      resignationDate: c.resignation_date,
      lastWorkingDay: c.last_working_day,
      reason: c.reason,
      assetsOutstanding: Number(p?.assets_outstanding ?? 0),
      itemsOutstanding: Number(p?.items_outstanding ?? 0),
      clearanceItemsOpen: Number(p?.clearance_items_open ?? 0),
      clearanceComplete: Boolean(p?.clearance_complete ?? false),
      fnfStatus: f?.status ?? null,
      fnfNetPayable: f ? Number(f.net_payable ?? 0) : null,
    };
  });
}

export interface ExitInterviewRow {
  id: string;
  question: string;
  answer: string | null;
  submittedAt: string | null;
}

/**
 * One exit case's interview.
 *
 * Ordered by created_at because the questions were inserted as rows in
 * questionnaire order (0037 stores them per-case so editing the questionnaire
 * never rewrites what a past leaver was asked) — that insert order IS the
 * intended sequence.
 */
export async function getExitInterview(exitCaseId: string): Promise<ExitInterviewRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('exit_interviews')
    .select('id, question, answer, submitted_at, created_at')
    .eq('exit_case_id', exitCaseId)
    .order('created_at', { ascending: true });
  if (error) {
    fail('getExitInterview: could not load the exit interview', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    submittedAt: isoOrNull(r.submitted_at),
  }));
}

export interface KtItemRow {
  id: string;
  task: string;
  handoverTo: string | null;
  handoverName: string | null;
  status: 'pending' | 'in_progress' | 'done';
  notes: string | null;
}

/** One exit case's knowledge-transfer items. */
export async function getKtItems(exitCaseId: string): Promise<KtItemRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('knowledge_transfer_items')
    .select('id, task, handover_to, status, notes, created_at, employees(full_name)')
    .eq('exit_case_id', exitCaseId)
    .order('created_at', { ascending: true });
  if (error) {
    fail('getKtItems: could not load handover items', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    task: r.task,
    handoverTo: r.handover_to,
    handoverName: r.employees?.full_name ?? null,
    status: r.status,
    notes: r.notes,
  }));
}

export interface ClearanceItemRow {
  id: string;
  area: string;
  description: string | null;
  cleared: boolean;
}

/** The clearance checklist for one exit case. */
export async function getClearanceItems(exitCaseId: string): Promise<ClearanceItemRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('exit_clearance_items')
    .select('id, area, description, cleared')
    .eq('exit_case_id', exitCaseId)
    .order('area');
  if (error) {
    fail('getClearanceItems: could not load clearance items', error);
  }
  return (data ?? []) as unknown as ClearanceItemRow[];
}

// ----------------------------------------------------------- leave salary ---
// The /leave page model (migration 0038): one paid-leave pool of 15 days plus
// an annual leave-salary working per employee. The old encashment/adjustment
// list queries died with the PL/CL/SL screen; the tables themselves remain.

export interface LeaveBalanceAdminRow {
  employeeId: string;
  code: string;
  name: string;
  year: number;
  type: string;
  balance: number;
}

/** Every employee's PAID-LEAVE pool for a year — the pool card on /leave. */
export async function getLeaveBalancesForYear(year: number): Promise<LeaveBalanceAdminRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('leave_balances')
    .select('employee_id, year, type, balance, employees(code, full_name)')
    .eq('year', year)
    // One pool now. Historic CL/SL rows stay in the table but not on screen.
    .eq('type', 'PL');
  if (error) {
    fail('getLeaveBalancesForYear: could not load balances', error);
  }
  return (data ?? [])
    .map((r: any) => ({
      employeeId: r.employee_id,
      code: r.employees?.code ?? '',
      name: r.employees?.full_name ?? '',
      year: Number(r.year),
      type: r.type,
      balance: Number(r.balance ?? 0),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface LeaveSalaryWorkingRow {
  id: string;
  employeeId: string;
  year: number;
  salaryBefore: number;
  salaryAfter: number;
  /** 'YYYY-MM-01' — first day of the post-appraisal salary. */
  incrementEffective: string;
  presentP1: number;
  presentP2: number;
  calendarDaysP1: number;
  calendarDaysP2: number;
  amountP1: number;
  amountP2: number;
  totalAmount: number;
  status: 'draft' | 'finalized' | 'paid';
  remarks: string | null;
  paidAt: string | null;
  updatedAt: string;
  /** HR-typed calendar-day denominators (0041); null = real calendar days. */
  calendarDaysP1Override: number | null;
  calendarDaysP2Override: number | null;
}

/**
 * Saved leave-salary workings for a year.
 *
 * Returns NULL — not [] — when the table is missing, so the page can tell
 * "migration 0038 not applied" apart from "no rows saved yet"; the two demand
 * different messages and only one of them is fixable from the UI.
 */
export async function getLeaveSalaryWorkings(
  year: number,
): Promise<LeaveSalaryWorkingRow[] | null> {
  const dbc = await createClient();
  const res = await dbc
    .from('leave_salary_workings')
    .select(
      `id, employee_id, year, salary_before, salary_after, increment_effective,
       present_p1, present_p2, calendar_days_p1, calendar_days_p2,
       amount_p1, amount_p2, total_amount, status, remarks, paid_at, updated_at,
       calendar_days_p1_override, calendar_days_p2_override`,
    )
    .eq('year', year);
  if (res.error) fail('getLeaveSalaryWorkings: could not load workings', res.error);
  return (res.data ?? []).map((r: any) => ({
    id: r.id,
    employeeId: r.employee_id,
    year: Number(r.year),
    salaryBefore: Number(r.salary_before ?? 0),
    salaryAfter: Number(r.salary_after ?? 0),
    incrementEffective: String(r.increment_effective).slice(0, 10),
    presentP1: Number(r.present_p1 ?? 0),
    presentP2: Number(r.present_p2 ?? 0),
    calendarDaysP1: Number(r.calendar_days_p1 ?? 0),
    calendarDaysP2: Number(r.calendar_days_p2 ?? 0),
    amountP1: Number(r.amount_p1 ?? 0),
    amountP2: Number(r.amount_p2 ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
    status: r.status,
    remarks: r.remarks,
    paidAt: isoOrNull(r.paid_at),
    updatedAt: iso(r.updated_at),
    calendarDaysP1Override:
      r.calendar_days_p1_override != null ? Number(r.calendar_days_p1_override) : null,
    calendarDaysP2Override:
      r.calendar_days_p2_override != null ? Number(r.calendar_days_p2_override) : null,
  }));
}

export interface LeaveSalaryEmployee {
  id: string;
  code: string;
  name: string;
  grossMonthly: number;
  dateOfJoining: string | null;
  status: string;
}

/**
 * Who belongs on the year's leave-salary sheet: everyone still on the roster,
 * PLUS anyone off it who already has a saved working for the year — a mid-year
 * leaver's payout row must not vanish the day HR marks them inactive.
 */
export async function getLeaveSalaryRoster(year: number): Promise<LeaveSalaryEmployee[]> {
  const dbc = await createClient();

  const { data, error } = await dbc
    .from('employees')
    .select('id, code, full_name, gross_monthly, date_of_joining, status')
    .in('status', ['active', 'on_notice'])
    .order('code');
  if (error) fail('getLeaveSalaryRoster: could not load employees', error);

  const rows = new Map<string, any>((data ?? []).map((e: any) => [e.id, e]));

  // Inactive employees with a saved working for this year still belong.
  const { data: saved, error: savedError } = await dbc
    .from('leave_salary_workings')
    .select('employee_id, employees(id, code, full_name, gross_monthly, date_of_joining, status)')
    .eq('year', year);
  if (savedError) fail('getLeaveSalaryRoster: could not load saved workings', savedError);
  for (const r of (saved ?? []) as any[]) {
    if (r.employees && !rows.has(r.employees.id)) rows.set(r.employees.id, r.employees);
  }

  return [...rows.values()]
    .map((e: any) => ({
      id: e.id,
      code: e.code ?? '',
      name: e.full_name ?? '',
      grossMonthly: Number(e.gross_monthly ?? 0),
      dateOfJoining: e.date_of_joining ?? null,
      status: e.status ?? '',
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Credit-weighted presence per employee per month for a whole year, in ONE
 * paged sweep of attendance_days. A full roster-year (~210 × 365 ≈ 77k rows)
 * far exceeds any single page, so this pages exactly like the importer:
 * ordered by the unique key — without an ORDER BY, .range() may repeat and
 * omit rows between pages, silently corrupting the presence sums.
 */
export async function getLeaveSalaryPresence(
  year: number,
): Promise<Record<string, number[]>> {
  const dbc = await createClient();
  const PAGE = 1000;
  const byEmployee: Record<string, number[]> = {};

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await dbc
      .from('attendance_days')
      .select('employee_id, work_date, status')
      .gte('work_date', `${year}-01-01`)
      .lte('work_date', `${year}-12-31`)
      .order('employee_id', { ascending: true })
      .order('work_date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) fail('getLeaveSalaryPresence: could not load attendance', error);

    const page = (data ?? []) as { employee_id: string; work_date: string; status: string }[];
    for (const r of page) {
      const months = (byEmployee[r.employee_id] ??= new Array(12).fill(0));
      const month = Number(String(r.work_date).slice(5, 7));
      if (month >= 1 && month <= 12) {
        months[month - 1] += PRESENT_CREDIT[r.status as keyof typeof PRESENT_CREDIT] ?? 0;
      }
    }
    if (page.length < PAGE) break;
  }
  return byEmployee;
}

// ------------------------------------------------------- attendance audit ---
export interface AuditEntry {
  id: string;
  eventType: string;
  message: string;
  actor: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  occurredAt: string;
}

/** Attendance-related audit trail (corrections, imports, night sweeps), newest
 *  first. Reads activity_log; messages are rendered as TEXT only (stored-XSS
 *  safe). Staff-gated by the activity_log read policy. */
export async function getAttendanceAudit(limit = 200): Promise<AuditEntry[]> {
  const log = await scoped(COLLECTIONS.activityLog);
  const rows = await log.find(
    { event_type: { $in: ['attendance_correction', 'register_import', 'night_sweep'] } },
    { sort: { occurred_at: -1 }, limit },
  );
  if (rows.length === 0) return [];

  // The names are RESOLVED here, not read off the row.
  //
  // The port planned to denormalise actor_name / employee_code / employee_name
  // at write time and declared them on the collection, but no insert ever wrote
  // them — so both columns on the audit screen were blank. Back-filling the
  // writers would still leave every existing entry blank, whereas this restores
  // exactly what the old SQL join showed. Two batched lookups for the whole
  // page, not the per-row join the comment worried about.
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const employeeIds = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))] as string[];

  const [actors, employees] = await Promise.all([
    actorIds.length
      ? (await scoped<UserDoc>(COLLECTIONS.users)).find(
          { _id: { $in: actorIds } },
          { projection: { full_name: 1, email: 1 } },
        )
      : Promise.resolve([]),
    employeeIds.length
      ? (await scoped<EmployeeDoc>(COLLECTIONS.employees)).find(
          { _id: { $in: employeeIds } },
          { projection: { full_name: 1, code: 1 } },
        )
      : Promise.resolve([]),
  ]);

  const actorById = new Map(actors.map((a) => [a._id, a.full_name ?? a.email ?? null]));
  const employeeById = new Map(
    employees.map((e) => [e._id, { name: e.full_name ?? null, code: e.code ?? null }]),
  );

  return rows.map((r) => {
    const employee = r.employee_id ? employeeById.get(r.employee_id as string) : undefined;
    return {
      id: r._id as string,
      eventType: r.event_type as string,
      message: r.message as string,
      // A row written before this, or by a deleted account, still falls back to
      // whatever was denormalised at the time rather than showing nothing.
      actor: actorById.get(r.actor_id as string) ?? ((r.actor_name as string | null) ?? null),
      employeeCode: employee?.code ?? ((r.employee_code as string | null) ?? null),
      employeeName: employee?.name ?? ((r.employee_name as string | null) ?? null),
      occurredAt: iso(r.occurred_at),
    };
  });
}

// --------------------------------------------------------------- payroll ---
export async function getPayslips(
  periodMonth: string = currentPeriodMonth(),
): Promise<PayslipRow[]> {
  const { start } = monthRange(periodMonth);
  const dbc = await createClient();

  const { data: run, error: runError } = await dbc
    .from('payroll_runs')
    .select('id')
    .eq('period_month', start)
    .maybeSingle();
  if (runError) fail('getPayslips: could not load the payroll run', runError);
  if (!run) return []; // no run for this month yet — a real empty state

  const { data, error } = await dbc
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
    id: r._id ?? r.id,
    periodMonth: r.period_month,
    status: r.status,
    workingDays: r.working_days,
    targetMinutes: r.target_minutes,
    monthClosedAt: isoOrNull(r.month_closed_at),
    draftsComputedAt: isoOrNull(r.drafts_computed_at),
    lockedAt: isoOrNull(r.locked_at),
    paidAt: isoOrNull(r.paid_at),
  };
}

/** Every payroll run, newest month first. */
export async function getPayrollRuns(): Promise<PayrollRunView[]> {
  const runs = await scoped(COLLECTIONS.payrollRuns);
  const rows = await runs.find({}, { sort: { period_month: -1 } });
  return rows.map(mapRun);
}

/** A single run by month, or null when that month has no run yet. */
export async function getPayrollRun(periodMonth: string): Promise<PayrollRunView | null> {
  const { start } = monthRange(periodMonth);
  const runs = await scoped(COLLECTIONS.payrollRuns);
  const row = await runs.findOne({ period_month: start });
  return row ? mapRun(row) : null;
}

// --------------------------------------------------------------- branches ---
export interface BranchRow {
  id: string;
  name: string;
  state: string;
}

/** All branches, alphabetical. */
export async function getBranches(): Promise<BranchRow[]> {
  const branches = await scoped<BranchDoc>(COLLECTIONS.branches);
  const rows = await branches.find(
    {},
    { projection: { name: 1, state: 1 }, sort: { name: 1 } },
  );
  return rows.map((b) => ({ id: b._id, name: b.name, state: b.state }));
}

// ------------------------------------------------------------ today board ---
/** Today's headcount / attendance KPIs, aggregated from v_today_board. */
export async function getTodayBoard(): Promise<TodayKpis> {
  const dbc = await createClient();
  const { data, error } = await dbc
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
/** Today's punch log, earliest punch first. */
export async function getPunchLogToday(): Promise<PunchLogRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
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
/** Today's birthdays and work anniversaries, from v_celebrations. */
export async function getCelebrationsToday(): Promise<Celebration[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
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

/** The dashboard activity feed, newest first. */
export async function getActivityFeed(limit = 20): Promise<ActivityRow[]> {
  const log = await scoped(COLLECTIONS.activityLog);
  const rows = await log.find(
    {},
    { projection: { message: 1, occurred_at: 1 }, sort: { occurred_at: -1 }, limit },
  );
  return rows.map((a) => ({
    id: a._id as string,
    when: clockTime(iso(a.occurred_at)),
    message: a.message as string,
  }));
}

// ------------------------------------------------- employee self-service ---

/** One employee's day strip for a month. */
export async function getMyAttendance(
  employeeId: string,
  periodMonth: string = currentPeriodMonth(),
): Promise<DayCell[]> {
  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();
  const { data, error } = await dbc
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
  const dbc = await createClient();
  const { data, error } = await dbc
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
  const dbc = await createClient();
  const res = await dbc
    .from('requests')
    .select(REQUEST_FIELDS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  // review_remark arrives with 0041 — retry without it until then.
  if (res.error) fail('getMyRequests: could not load requests', res.error);
  return (res.data ?? []).map(mapRequest);
}

/** One employee's helpdesk tickets, newest first. */
const TICKET_COLS = 'id, subject, body, category, status, created_at, resolution_note, employees(code, full_name)';

export async function getMyTickets(employeeId: string): Promise<TicketView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('helpdesk_tickets')
    .select(TICKET_COLS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  // Migration 0018 (resolution_note) not applied yet → retry without the column.
  if (res.error) fail('getMyTickets: could not load tickets', res.error);
  return (res.data ?? []).map(mapTicket);
}

// --------------------------------------------------------- leave balances ---
export interface LeaveBalanceRow {
  type: LeaveType;
  balance: number;
}

/**
 * An employee's PAID-LEAVE balance for the current year. PL-only since the
 * leave-salary policy: historic CL/SL rows survive in the table but would
 * render retired pills on the dashboard.
 */
export async function getLeaveBalances(employeeId: string): Promise<LeaveBalanceRow[]> {
  const balances = await scoped(COLLECTIONS.leaveBalances);
  const rows = await balances.find({
    employee_id: employeeId,
    year: Number(todayISO().slice(0, 4)),
    type: 'PL',
  });
  return rows.map((b) => ({ type: b.type as LeaveType, balance: toNumber(b.balance) }));
}

// ------------------------------------------------------- employee code map ---
/** employees.code -> employees.id, for the Excel importer. */
export async function getEmployeeCodeMap(): Promise<Record<string, string>> {
  const employees = await scoped<EmployeeDoc>(COLLECTIONS.employees);
  const rows = await employees.find({}, { projection: { code: 1 } });
  return Object.fromEntries(rows.map((e) => [e.code, e._id]));
}

// ------------------------------------------------------------- employees ---
export interface EmployeeListRow {
  code: string; name: string; branch: string; gender: string;
  // uan was declared non-nullable, but employees.pf_uan is nullable and the old
  // mapper returned null through an `any`. Corrected rather than coerced: the
  // register shows a blank UAN column for employees who have none.
  doj: string; gross: number; uan: string | null; esic_no: string | null;
  active: boolean;
}

/** Employee roster. Active-only by default; pass includeInactive to also return
 *  deactivated employees (so the UI can offer a "reactivate"). */
export async function getEmployees(includeInactive = false): Promise<EmployeeListRow[]> {
  const employees = await scoped<EmployeeDoc>(COLLECTIONS.employees);
  // No join: branch_name is denormalised onto the employee (see EmployeeDoc).
  // This used to be an embedded PostgREST select, i.e. a join on every read of
  // a list that renders constantly.
  const rows = await employees.find(includeInactive ? {} : { status: 'active' }, {
    sort: { code: 1 },
  });
  return rows.map((e) => ({
    code: e.code,
    name: e.full_name,
    branch: e.branch_name ?? '',
    gender: e.gender,
    doj: e.date_of_joining,
    // toNumber, not Number(): the stored value is Decimal128, and this is the
    // display edge. Never feed the result back into a calculation.
    gross: toNumber(e.gross_monthly),
    uan: e.pf_uan,
    esic_no: e.esic_number,
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
 * The signed-in user's notifications, newest first. policies.ts restricts this
 * to `recipient_id` = the caller, so no caller-supplied id is needed or accepted.
 *
 * ONLY a missing session is absorbed, and only because of an ordering problem
 * in the layouts: both await this in the same Promise.all as getSession(), so a
 * NotSignedInError out of here rejected the batch before the
 * `if (!profile) redirect('/login')` underneath it could run — a revoked or
 * disabled account, which auth/middleware.ts documents as being caught by
 * exactly that redirect, got the error boundary instead of the login screen.
 *
 * Every other failure is rethrown. A catch-all here is worse than the crash it
 * prevents: a dropped connection or a mis-declared policy would render as "you
 * have no notifications" on every page, with nothing in the logs to say the
 * bell had stopped working.
 */
export async function getMyNotifications(limit = 20): Promise<NotificationRow[]> {
  try {
    const notifications = await scoped(COLLECTIONS.notifications);
    const rows = await notifications.find({}, { sort: { created_at: -1 }, limit });
    return rows.map((n) => ({
      id: n._id as string,
      kind: n.kind as string,
      title: n.title as string,
      body: (n.body as string | null) ?? null,
      link: (n.link as string | null) ?? null,
      readAt: isoOrNull(n.read_at),
      createdAt: iso(n.created_at),
    }));
  } catch (error) {
    if (error instanceof NotSignedInError) return [];
    throw error;
  }
}

/** Unread count for the topbar badge. Absorbs a missing session only — see above. */
export async function getUnreadNotificationCount(): Promise<number> {
  try {
    const notifications = await scoped(COLLECTIONS.notifications);
    return await notifications.countDocuments({ read_at: null });
  } catch (error) {
    if (error instanceof NotSignedInError) return 0;
    throw error;
  }
}

// ------------------------------------------------------- week-off policy ---
/**
 * The scheduled week-off rule (settings-driven, migration 0010). Falls back to
 * the documented default — Sundays off, Saturdays off except the 2nd and 4th —
 * whenever the settings are absent or unreadable, so the register never loses
 * its week-off columns over a missing row.
 */
export async function getWeekOffPolicy(): Promise<WeekOffPolicy> {
  const dbc = await createClient();
  const { data, error } = await dbc
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
  const employees = await scoped<EmployeeDoc>(COLLECTIONS.employees);
  const rows = await employees.find(
    { status: 'active' },
    { projection: { code: 1, full_name: 1 }, sort: { code: 1 } },
  );
  return rows.map((e) => ({ id: e._id, code: e.code, name: e.full_name }));
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
  /** The reviewer's note — set when a claim is rejected. Distinct from `remarks`. */
  reviewRemark: string | null;
  status: 'pending' | 'finance_review' | 'approved' | 'rejected' | 'paid';
  createdAt: string;
  /** Receipt object path in the private bucket (0035); null when none attached. */
  receiptPath: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  financeReviewedAt: string | null;
}

const REIMBURSEMENT_FIELDS = `id, employee_id, claim_date, description, purpose, source_medium,
  kms, mode_of_payment, amount, remarks, review_remark, status, created_at,
  receipt_path, paid_at, payment_ref, finance_reviewed_at,
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
    reviewRemark: r.review_remark ?? null,
    status: r.status,
    createdAt: iso(r.created_at),
    receiptPath: r.receipt_path ?? null,
    paidAt: isoOrNull(r.paid_at),
    paymentRef: r.payment_ref ?? null,
    financeReviewedAt: isoOrNull(r.finance_reviewed_at),
  };
}

/** One lifecycle event on a claim's timeline (migration 0035). */
export interface ReimbursementEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  remark: string | null;
  actorName: string | null;
  occurredAt: string;
}

/** A claim's timeline, oldest first (reads as a story). */
export async function getReimbursementEvents(claimId: string): Promise<ReimbursementEvent[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('reimbursement_events')
    .select('id, action, from_status, to_status, remark, actor_name, occurred_at')
    .eq('claim_id', claimId)
    .order('occurred_at', { ascending: true });
  if (error) {
    fail('getReimbursementEvents: could not load the claim timeline', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    action: r.action,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    remark: r.remark,
    actorName: r.actor_name,
    occurredAt: iso(r.occurred_at),
  }));
}

/** Every claim, newest first — the staff review queue. */
export async function getReimbursements(): Promise<ReimbursementView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('reimbursement_claims')
    .select(REIMBURSEMENT_FIELDS)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getReimbursements: could not load claims', res.error);
  }
  return (res.data ?? []).map(mapReimbursement);
}

/** One employee's own claims, newest first. */
export async function getMyReimbursements(employeeId: string): Promise<ReimbursementView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('reimbursement_claims')
    .select(REIMBURSEMENT_FIELDS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getMyReimbursements: could not load claims', res.error);
  }
  return (res.data ?? []).map(mapReimbursement);
}

/** The ₹/km rate used to auto-calculate travel claims (settings-driven). */
export async function getReimbursementRate(): Promise<number> {
  const FALLBACK = 3.5;
  const dbc = await createClient();
  const { data, error } = await dbc
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
  /** 0041: false = on hold by staff, an employee cannot apply against it. */
  isApplicable: boolean;
  expiresOn: string | null;
}

// The two newer columns (expires_on: 0036, is_applicable: 0041) may be missing
// on an un-migrated database; both selects retry without them and default.
const COMP_OFF_FIELDS = 'id, employee_id, earned_date, status, used_date, expires_on, is_applicable';

function mapCompOff(c: any): CompOffRow {
  return {
    id: c.id,
    employeeId: c.employee_id,
    earnedDate: String(c.earned_date).slice(0, 10),
    status: c.status,
    usedDate: c.used_date ? String(c.used_date).slice(0, 10) : null,
    isApplicable: c.is_applicable !== false,
    expiresOn: c.expires_on ? String(c.expires_on).slice(0, 10) : null,
  };
}

/**
 * Comp-off credits already granted for a month, so the register can tell an
 * un-granted eligible day from one that has already been credited.
 * Keyed by `${employeeId}|${earnedDate}` at the callsite.
 */
export async function getCompOffsForMonth(
  periodMonth: string = currentPeriodMonth(),
): Promise<CompOffRow[]> {
  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();
  const res = await dbc
    .from('comp_offs')
    .select(COMP_OFF_FIELDS)
    .gte('earned_date', start)
    .lte('earned_date', end);
  if (res.error) {
    fail('getCompOffsForMonth: could not load comp offs', res.error);
  }
  return (res.data ?? []).map(mapCompOff);
}

/** One employee's comp-off credits, newest earned first. */
export async function getMyCompOffs(employeeId: string): Promise<CompOffRow[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('comp_offs')
    .select(COMP_OFF_FIELDS)
    .eq('employee_id', employeeId)
    .order('earned_date', { ascending: false });
  if (res.error) {
    fail('getMyCompOffs: could not load comp offs', res.error);
  }
  return (res.data ?? []).map(mapCompOff);
}

/** A live (not yet spent/expired) credit with its owner, for the admin card. */
export interface CompOffAdminRow extends CompOffRow {
  code: string;
  name: string;
}

/**
 * Every live comp-off credit (available or awaiting approval) with its owner —
 * the admin dashboard's comp-off card: per-employee balances plus the
 * applicable/not-applicable switch per credit.
 */
export async function getCompOffAdmin(): Promise<CompOffAdminRow[]> {
  const dbc = await createClient();
  const FIELDS = (cols: string) => `${cols}, employees(code, full_name)`;
  const res = await dbc
    .from('comp_offs')
    .select(FIELDS(COMP_OFF_FIELDS))
    .in('status', ['available', 'applied'])
    .order('earned_date', { ascending: true });
  if (res.error) {
    fail('getCompOffAdmin: could not load comp offs', res.error);
  }
  return (res.data ?? [])
    .map((c: any) => ({
      ...mapCompOff(c),
      code: c.employees?.code ?? '',
      name: c.employees?.full_name ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.earnedDate.localeCompare(b.earnedDate));
}

/** Full editable fields for one employee, keyed by code. Null when not found. */
export interface EmployeeEditRow {
  code: string;
  full_name: string;
  branch: string;
  department: string | null;
  designation: string | null;
  gender: string;
  date_of_joining: string;
  date_of_birth: string | null;
  whatsapp: string | null;
  mobile_official: string | null;
  mobile_personal: string | null;
  email_official: string | null;
  email_personal: string | null;
  aadhaar: string | null;
  pan: string | null;
  pf_uan: string | null;
  esic_number: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relation: string | null;
  emergency_contact_phone: string | null;
  gross_monthly: number;
  basic_da: number;
  hra: number;
  special_allowance: number;
}

export async function getEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  const dbc = await createClient();
  const FULL_COLS =
    `code, full_name, designation, gender, date_of_joining, date_of_birth, whatsapp,
     mobile_official, mobile_personal, email_official, email_personal, aadhaar,
     pan, pf_uan, esic_number,
     bank_name, bank_account_number, bank_ifsc,
     emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
     gross_monthly, basic_da, hra, special_allowance, branches(name), departments(name)`;

  const res = await dbc.from('employees').select(FULL_COLS).eq('code', code).maybeSingle();
  const { data, error } = res;
  if (error) fail('getEmployeeForEdit: could not load employee', error);
  if (!data) return null;
  const e: any = data;
  return {
    code: e.code,
    full_name: e.full_name,
    branch: e.branches?.name ?? '',
    department: e.departments?.name ?? null,
    designation: e.designation ?? null,
    gender: e.gender,
    date_of_joining: e.date_of_joining,
    date_of_birth: e.date_of_birth,
    whatsapp: e.whatsapp,
    mobile_official: e.mobile_official ?? null,
    mobile_personal: e.mobile_personal ?? null,
    email_official: e.email_official ?? null,
    email_personal: e.email_personal ?? null,
    aadhaar: e.aadhaar ?? null,
    pan: e.pan,
    pf_uan: e.pf_uan,
    esic_number: e.esic_number,
    bank_name: e.bank_name ?? null,
    bank_account_number: e.bank_account_number ?? null,
    bank_ifsc: e.bank_ifsc ?? null,
    emergency_contact_name: e.emergency_contact_name ?? null,
    emergency_contact_relation: e.emergency_contact_relation ?? null,
    emergency_contact_phone: e.emergency_contact_phone ?? null,
    gross_monthly: Number(e.gross_monthly),
    basic_da: Number(e.basic_da),
    hra: Number(e.hra),
    special_allowance: Number(e.special_allowance),
  };
}

/** Distinct department names — suggestions for the Add/Edit Employee combobox. */
export async function getDepartments(): Promise<string[]> {
  const departments = await scoped<DepartmentDoc>(COLLECTIONS.departments);
  const rows = await departments.find(
    {},
    { projection: { name: 1 }, sort: { name: 1 } },
  );
  // The same department name can exist under several branches, so the list is
  // deduplicated — callers want the set of names, not the rows.
  return Array.from(new Set(rows.map((d) => d.name)));
}

// ----------------------------------------------------------------- items ---
/** One inventory item (migration 0026) with derived quantities from v_items. */
export interface ItemRow {
  id: string;
  item_code: string | null;
  item_name: string;
  category: string | null;
  brand: string | null;
  size_spec: string | null;
  total_quantity: number;
  unit: string | null;
  returnable: boolean;
  status: string;
  remarks: string | null;
  quantity_assigned: number;
  quantity_remaining: number;
}

export async function getItems(): Promise<ItemRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('v_items')
    .select(
      `id, item_code, item_name, category, brand, size_spec, total_quantity, unit,
       returnable, status, remarks, quantity_assigned, quantity_remaining`,
    )
    .order('item_name');
  if (error) {
    fail('getItems: could not load items', error);
  }
  return (data ?? []) as unknown as ItemRow[];
}

/** One assignment (issuance) of an item to an employee. */
export interface ItemAssignmentRow {
  id: string;
  item_id: string;
  person_name: string | null;
  employee_code: string | null;
  quantity: number;
  assigned_date: string;
  assigned_by: string | null;
  returned: boolean;
  returned_date: string | null;
  remarks: string | null;
}

export async function getItemAssignments(itemId: string): Promise<ItemAssignmentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('item_assignments')
    .select(
      `id, item_id, person_name, employee_code, quantity, assigned_date, assigned_by,
       returned, returned_date, remarks`,
    )
    .eq('item_id', itemId)
    .order('assigned_date', { ascending: false });
  if (error) {
    fail('getItemAssignments: could not load assignments', error);
  }
  return (data ?? []) as unknown as ItemAssignmentRow[];
}

// ---------------------------------------------------------------- assets ---
/** One row of the IT asset register (migration 0025). Admin/HR only. */
export interface AssetRow {
  id: string;
  purchase_date: string | null;
  purchase_cost: number | null;
  desktop_name: string;
  asset_category: string | null;
  brand: string | null;
  serial_no: string | null;
  model_no: string | null;
  warranty_upto: string | null;
  warranty_renew: string | null;
  product_id: string | null;
  device_id: string | null;
  processor: string | null;
  ram: string | null;
  graphics_card: string | null;
  storage: string | null;
  antivirus: string | null;
  assigned_employee_id: string | null;
  assigned_person_name: string | null;
  assigned_employee_code: string | null;
  assigned_date: string | null;
}

const ASSET_COLS =
  `id, purchase_date, purchase_cost, desktop_name, asset_category, brand, serial_no, model_no,
   warranty_upto, warranty_renew, product_id, device_id, processor, ram, graphics_card, storage,
   antivirus, assigned_employee_id, assigned_person_name, assigned_employee_code, assigned_date`;

export async function getAssets(): Promise<AssetRow[]> {
  const dbc = await createClient();
  const res = await dbc.from('assets').select(ASSET_COLS).order('desktop_name');
  if (res.error) {
    fail('getAssets: could not load assets', res.error);
  }
  // purchase_cost is stored as Decimal128 — money is never a float at rest
  // (lib/db/money.ts). The screen only displays it, so widen to a number here
  // rather than leaking a BSON type into a client component.
  const rows = (res.data ?? []) as unknown as (Omit<AssetRow, 'purchase_cost'> & {
    purchase_cost: unknown;
  })[];
  return rows.map((r) => ({
    ...r,
    purchase_cost: r.purchase_cost == null ? null : Number(String(r.purchase_cost)),
  }));
}

/** Asset stock summary from v_asset_summary (migration 0034). */
export interface AssetSummaryRow {
  category: string;
  total: number;
  assigned: number;
  available: number;
  warranty_expiring: number;
}

export async function getAssetSummary(): Promise<AssetSummaryRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('v_asset_summary')
    .select('category, total, assigned, available, warranty_expiring');
  if (error) {
    fail('getAssetSummary: could not load the asset summary', error);
  }
  return (data ?? []).map((r: any) => ({
    category: r.category,
    total: Number(r.total ?? 0),
    assigned: Number(r.assigned ?? 0),
    available: Number(r.available ?? 0),
    warranty_expiring: Number(r.warranty_expiring ?? 0),
  }));
}

/** One asset transfer-history row (migration 0034). */
export interface AssetAssignmentRow {
  id: string;
  asset_id: string;
  person_name: string | null;
  employee_code: string | null;
  assigned_date: string;
  assigned_by: string | null;
  returned: boolean;
  returned_date: string | null;
  remarks: string | null;
}

export async function getAssetAssignments(assetId: string): Promise<AssetAssignmentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('asset_assignments')
    .select('id, asset_id, person_name, employee_code, assigned_date, assigned_by, returned, returned_date, remarks')
    .eq('asset_id', assetId)
    .order('assigned_date', { ascending: false });
  if (error) {
    fail('getAssetAssignments: could not load history', error);
  }
  return (data ?? []) as unknown as AssetAssignmentRow[];
}

/** One asset maintenance row (migration 0034). */
export interface AssetMaintenanceRow {
  id: string;
  asset_id: string;
  maint_date: string;
  maint_type: string | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  next_due: string | null;
  created_by: string | null;
}

export async function getAssetMaintenance(assetId: string): Promise<AssetMaintenanceRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('asset_maintenance')
    .select('id, asset_id, maint_date, maint_type, cost, vendor, notes, next_due, created_by')
    .eq('asset_id', assetId)
    .order('maint_date', { ascending: false });
  if (error) {
    fail('getAssetMaintenance: could not load maintenance', error);
  }
  return (data ?? []).map((r: any) => ({ ...r, cost: r.cost == null ? null : Number(r.cost) })) as AssetMaintenanceRow[];
}

// ------------------------------------------------- employee assets / items ---
/** An asset currently assigned to the signed-in employee (migration 0028). */
export interface MyAssetRow {
  id: string;
  desktop_name: string;
  brand: string | null;
  serial_no: string | null;
  model_no: string | null;
  assigned_date: string | null;
}

export async function getMyAssets(employeeId: string): Promise<MyAssetRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('assets')
    .select('id, desktop_name, brand, serial_no, model_no, assigned_date')
    .eq('assigned_employee_id', employeeId)
    .order('desktop_name');
  if (error) {
    // Table/column not migrated yet, or no read access — show nothing, don't crash.
    fail('getMyAssets: could not load assigned assets', error);
  }
  return (data ?? []) as unknown as MyAssetRow[];
}

/** An item issued to the signed-in employee (migration 0028 RLS). */
export interface MyItemRow {
  id: string;
  itemName: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  assignedDate: string;
  returned: boolean;
  returnedDate: string | null;
}

export async function getMyItems(employeeId: string): Promise<MyItemRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('item_assignments')
    .select('id, quantity, assigned_date, returned, returned_date, items(item_name, category, unit)')
    .eq('employee_id', employeeId)
    .order('assigned_date', { ascending: false });
  if (error) {
    fail('getMyItems: could not load assigned items', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    itemName: r.items?.item_name ?? 'Item',
    category: r.items?.category ?? null,
    unit: r.items?.unit ?? null,
    quantity: r.quantity,
    assignedDate: String(r.assigned_date).slice(0, 10),
    returned: !!r.returned,
    returnedDate: r.returned_date ? String(r.returned_date).slice(0, 10) : null,
  }));
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
  /**
   * Month-to-date hours still owed: (working days so far × full_day_minutes)
   * − worked minutes so far, floored at zero. 'HH:MM'.
   */
  pendingHours: string;
  pendingMinutes: number;
  /** The month-to-date target the pending figure is measured against. 'HH:MM'. */
  targetHours: string;
}

export async function getEmployeeOverview(
  employeeId: string | null,
  fallbackName?: string | null,
  periodMonth: string = currentPeriodMonth(),
): Promise<EmployeeOverview> {
  // No linked employee record is a real state (e.g. a staff login), not an error.
  if (!employeeId) {
    return {
      name: fallbackName ?? '', code: '', branch: '',
      present: 0, halfDays: 0, leaves: 0, workedHours: '00:00', netPay: null,
      pendingHours: '00:00', pendingMinutes: 0, targetHours: '00:00',
    };
  }

  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();

  const { data: emp, error: empError } = await dbc
    .from('employees')
    .select('code, full_name, branches(name)')
    .eq('id', employeeId)
    .maybeSingle();
  if (empError) fail('getEmployeeOverview: could not load the employee', empError);
  if (!emp) throw new Error(`getEmployeeOverview: no employee with id ${employeeId}`);

  const { data: days, error: daysError } = await dbc
    .from('attendance_days')
    .select('work_date, status, worked_minutes')
    .eq('employee_id', employeeId)
    .gte('work_date', start)
    .lte('work_date', end);
  if (daysError) fail('getEmployeeOverview: could not load attendance', daysError);

  const rows = days ?? [];
  const count = (s: string) => rows.filter((d: any) => d.status === s).length;
  const workedMin = rows.reduce((a: number, d: any) => a + (d.worked_minutes ?? 0), 0);

  // Pending hours, month to date. Mirrors fn_compute_payslip's target rule:
  // working days = P+CO+OH+T+S+LM (+ 0.5·HD), each owing full_day_minutes.
  // Only days up to today count — tomorrow's shift is not yet "pending".
  // settings is readable by every authenticated user (0003), so this works for
  // employees too; the seeded default stands in if the row is missing.
  const today = todayISO();
  const WORKING_STATUSES = ['P', 'CO', 'OH', 'T', 'S', 'LM'];
  let workingCredit = 0;
  let workedToDate = 0;
  for (const d of rows as { work_date: string; status: string; worked_minutes: number | null }[]) {
    if (String(d.work_date) > today) continue;
    if (WORKING_STATUSES.includes(d.status)) workingCredit += 1;
    else if (d.status === 'HD') workingCredit += 0.5;
    workedToDate += d.worked_minutes ?? 0;
  }
  let fullDayMin = 555;
  const { data: fdm } = await dbc
    .from('settings')
    .select('value')
    .eq('key', 'full_day_minutes')
    .maybeSingle<{ value: unknown }>();
  const fdmNum = Number(fdm?.value);
  if (Number.isFinite(fdmNum) && fdmNum > 0) fullDayMin = fdmNum;
  const targetMin = Math.round(workingCredit * fullDayMin);
  const pendingMin = Math.max(0, targetMin - workedToDate);

  const { data: slip, error: slipError } = await dbc
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
    pendingHours: minutesToHHMM(pendingMin),
    pendingMinutes: pendingMin,
    targetHours: minutesToHHMM(targetMin),
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

/** Published policies for an employee, flagged with whether they've acknowledged. */
export async function getEmployeePolicies(employeeId: string | null): Promise<PolicyView[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('policies')
    .select('id, title, category, version, effective_date, body, published')
    .eq('published', true)
    .order('category');
  if (error) fail('getEmployeePolicies: could not load policies', error);

  let acked = new Set<string>();
  if (employeeId) {
    const { data: acks, error: acksError } = await dbc
      .from('policy_acknowledgements')
      .select('policy_id')
      .eq('employee_id', employeeId);
    if (acksError) fail('getEmployeePolicies: could not load acknowledgements', acksError);
    acked = new Set((acks ?? []).map((a: any) => a.policy_id));
  }
  return (data ?? []).map((p: any) => ({ ...p, acknowledged: acked.has(p.id) }));
}

/**
 * policy_id -> how many employees have filed a read receipt.
 *
 * Staff-only in practice: acks_portal_read (0004) lets staff see every row, an
 * employee only their own. Until this existed nothing in the app ever read
 * policy_acknowledgements except the employee's own dashboard, so HR had no way
 * to see the receipts the policies screen promises are being recorded.
 */
export async function getPolicyAckCounts(): Promise<Record<string, number>> {
  const acks = await scoped(COLLECTIONS.policyAcknowledgements);
  // Counted in the database rather than by pulling every receipt across and
  // tallying them in JavaScript, which is what the row-by-row version did.
  const rows = await acks.aggregate<{ _id: string; n: number }>([
    { $group: { _id: '$policy_id', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

/** Active headcount — the denominator for "n/N read". */
export async function getActiveEmployeeCount(): Promise<number> {
  try {
    const employees = await scoped<EmployeeDoc>(COLLECTIONS.employees);
    return await employees.countDocuments({ status: 'active' });
  } catch {
    return 0;
  }
}

/** All policies for the admin management screen. */
export async function getAllPolicies(): Promise<Policy[]> {
  const policies = await scoped(COLLECTIONS.policies);
  const rows = await policies.find({}, { sort: { updated_at: -1 } });
  return rows.map((r) => ({ ...r, id: r._id })) as unknown as Policy[];
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
  const holidays = await scoped(COLLECTIONS.holidays);
  const rows = await holidays.find({}, { sort: { holiday_date: 1 } });
  return rows.map((h) => ({
    id: h._id as string,
    date: h.holiday_date as string,
    name: h.name as string,
    // A null branch still means "all branches", same as before.
    branch: (h.branch_name as string | null) ?? null,
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
  /** Storage path of the attached PDF (notice-attachments bucket), if any. */
  pdfPath: string | null;
}

/** Notices, newest first. */
export async function getNotices(): Promise<NoticeView[]> {
  const notices = await scoped(COLLECTIONS.notices);
  const rows = await notices.find({}, { sort: { created_at: -1 } });
  return rows.map((n) => ({
    id: n._id as string,
    title: n.title as string,
    body: (n.body as string | null) ?? null,
    channel: n.channel as NoticeView['channel'],
    branch: (n.branch_name as string | null) ?? null,
    published: n.published_at != null,
    publishedAt: isoOrNull(n.published_at),
    createdAt: iso(n.created_at),
    pdfPath: (n.pdf_url as string | null) ?? null,
  }));
}

/** The ids of notices this employee has marked read (for the dashboard). */
export async function getReadNoticeIds(employeeId: string | null): Promise<string[]> {
  if (!employeeId) return [];
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('notice_reads')
    .select<{ notice_id: string }[]>('notice_id')
    .eq('employee_id', employeeId);
  if (error) fail('getReadNoticeIds: could not load read receipts', error);
  return (data ?? []).map((r: { notice_id: string }) => r.notice_id);
}

/**
 * Best-effort sweep of expired notices, run whenever staff publish one, so the
 * table stays clean on a deployment with nothing scheduling the nightly job.
 * Employees never see expired notices regardless (the dashboard filters them
 * out). Errors are swallowed: this is opportunistic cleanup, and a hiccup here
 * must never break the page that triggered it.
 *
 * The retention rule itself lives in ONE place — db/scheduler.ts — because it
 * used to live in two, with a different window in each. See
 * NOTICE_RETENTION_DAYS.
 */
export async function purgeExpiredNotices(): Promise<void> {
  try {
    await deleteExpiredNotices();
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
    createdAt: iso(t.created_at),
  };
}

/** Helpdesk tickets, open first then newest. */
export async function getTickets(): Promise<TicketView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('helpdesk_tickets')
    .select(TICKET_COLS)
    .order('created_at', { ascending: false });
  if (res.error) fail('getTickets: could not load tickets', res.error);
  // Open tickets first, otherwise preserve newest-first ordering.
  return (res.data ?? [])
    .map(mapTicket)
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
}

// --------------------------------------------------- helpdesk thread ---
export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  /** The author's role at post time ('admin' | 'hr' | … | 'employee'), for the label. */
  authorRole: string | null;
  /** Distinguishes a staff/HR follow-up from the employee's own, for the pill. */
  authorIsStaff: boolean;
  createdAt: string;
}

function mapComment(c: any): TicketComment {
  return {
    id: c.id,
    ticketId: c.ticket_id,
    body: c.body,
    authorId: c.author_id ?? null,
    authorName: c.author_name ?? null,
    authorRole: c.author_role ?? null,
    authorIsStaff: !!c.author_is_staff,
    // created_at is a BSON date, and TicketComment.createdAt is a string that
    // crosses into a client component — iso() is the one place that conversion
    // is decided.
    createdAt: iso(c.created_at),
  };
}

/**
 * Follow-up comments for the given tickets, grouped by ticket id and ordered
 * oldest-first. Staff read every thread; an employee reads the threads of the
 * tickets they raised. That scoping is done by the parent-ticket check below,
 * not by the comment collection's own policy — see the comment there.
 */
export async function getTicketComments(
  ticketIds: string[],
): Promise<Record<string, TicketComment[]>> {
  if (ticketIds.length === 0) return {};

  // THE PARENT-TICKET CHECK, which is what decides who may read a comment.
  //
  // The SQL policy was `exists (select 1 from helpdesk_tickets t where
  // t.id = ticket_id and (is_portal() or t.employee_id = current_employee_id()))`.
  // A Mongo filter cannot join, and the port replaced that join with a filter
  // on the comment's own author_id — which is a different rule with two
  // failures: an employee could no longer read the STAFF replies on their own
  // ticket (the drawer showed only their own messages after a reload), and the
  // rule said nothing about whether they may see the ticket at all.
  //
  // So the join is done here instead: narrow the ids to the tickets this
  // caller can actually see, then read the comments for exactly those.
  const tickets = await scoped<{ _id: string }>(COLLECTIONS.helpdeskTickets);
  const visible = await tickets.find(
    { _id: { $in: ticketIds } },
    { projection: { _id: 1 } },
  );
  const allowed = visible.map((t) => String(t._id));
  if (allowed.length === 0) return {};

  // Unscoped, because the rule above IS the collection's access rule and it has
  // just been applied. afterParentCheck() rather than systemCollection(): this
  // runs on a request, and the name says where to find the check.
  const comments = afterParentCheck<{ _id: string; ticket_id: string; created_at: Date }>(
    COLLECTIONS.helpdeskTicketComments,
  );
  const rows = await comments.find(
    { ticket_id: { $in: allowed } },
    { sort: { created_at: 1 } },
  );

  const byTicket: Record<string, TicketComment[]> = {};
  for (const row of rows) {
    const c = mapComment({ ...row, id: row._id });
    (byTicket[c.ticketId] ??= []).push(c);
  }
  return byTicket;
}

// --------------------------------------------------------------- settings ---
export interface SettingView {
  key: string;
  value: unknown;
  label: string | null;
  description: string | null;
}

/** App settings. */
// ------------------------------------------------------------- topbar ---
/** '23:00' (or a JSON-quoted "23:00") -> '11:00 PM'. Null when unparseable. */
function prettyClock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^"?(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  if (!Number.isFinite(h) || h > 23) return null;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/**
 * Live figures for the topbar's page subtitles (see pageHeader in constants).
 *
 * DELIBERATE EXCEPTION to the throw-on-error rule at the top of this file, for
 * the same reason as getWeekOffPolicy/getReimbursementRate: a subtitle is
 * decoration. This runs in the (portal) layout, so throwing here would take down
 * EVERY staff page over a cosmetic count. Each lookup degrades to null and
 * pageHeader() then falls back to a plain description instead of a wrong number.
 *
 * Cost: five count/single-row lookups issued in parallel (~one round trip), paid
 * once per full page load — layouts are preserved across client-side navigation
 * and re-run on router.refresh(), which the mutating screens already call.
 */
export async function getTopbarStats(): Promise<TopbarStats> {
  const now = new Date();
  const IST = 'Asia/Kolkata';
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: IST, ...opts }).format(now);

  const base: TopbarStats = {
    todayLabel: fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    periodLabel: fmt({ month: 'long', year: 'numeric' }),
    year: Number(todayISO().slice(0, 4)),
    activeEmployees: null,
    branches: [],
    pendingApprovals: null,
    runStatus: null,
    nightSweep: null,
  };

  if (!isMongoConfigured()) return base;

  try {
    const dbc = await createClient();
    const periodMonth = `${todayISO().slice(0, 7)}-01`;
    const [employees, branches, approvals, run, sweep] = await Promise.all([
      dbc.from('employees').select('code', { count: 'exact', head: true }).eq('status', 'active'),
      dbc.from('branches').select('name').order('name'),
      dbc.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      dbc
        .from('payroll_runs')
        .select('status')
        .eq('period_month', periodMonth)
        .maybeSingle<{ status: string }>(),
      dbc
        .from('settings')
        .select('value')
        .eq('key', 'night_sweep_time')
        .maybeSingle<{ value: unknown }>(),
    ]);

    return {
      ...base,
      activeEmployees: employees.error ? null : employees.count ?? null,
      branches: branches.error ? [] : (branches.data ?? []).map((b: any) => b.name as string),
      pendingApprovals: approvals.error ? null : approvals.count ?? null,
      runStatus: run.error ? null : run.data?.status ?? null,
      nightSweep: sweep.error ? null : prettyClock(sweep.data?.value),
    };
  } catch {
    return base;
  }
}

export async function getSettings(): Promise<SettingView[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
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
  /** The approver's reason for the decision (0041), shown to the employee. */
  reviewRemark: string | null;
  /** When the request was submitted (ISO timestamp). */
  createdAt: string;
  /** When it was decided; null while pending/cancelled-unreviewed. */
  reviewedAt: string | null;
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
    reviewRemark: r.review_remark ?? null,
    createdAt: iso(r.created_at),
    reviewedAt: isoOrNull(r.reviewed_at),
  };
}
const REQUEST_FIELDS = `id, type, leave_kind, start_date, end_date, days, reason, status,
  balance_after, review_remark, created_at, reviewed_at, employees(code, full_name, branches(name))`;

/** Leave / duty requests, pending first then reviewed. */
export async function getRequests(): Promise<RequestView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('requests')
    .select(REQUEST_FIELDS)
    .order('created_at', { ascending: false });
  if (res.error) fail('getRequests: could not load requests', res.error);
  // Pending first, otherwise preserve newest-first ordering.
  return (res.data ?? [])
    .map(mapRequest)
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
}

// ---------------------------------------------------------- on leave today ---
export interface OnLeaveTodayRow {
  employeeId: string;
  name: string;
  branch: string;
  startDate: string;
  endDate: string;
}

/**
 * Employees on APPROVED leave today (IST), via SECURITY DEFINER
 * fn_on_leave_today (0041) so ordinary employees can see colleagues' names.
 * Returns [] when the function is not installed yet.
 */
export async function getOnLeaveToday(): Promise<OnLeaveTodayRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc.rpc('fn_on_leave_today');
  // An unregistered rpc comes back with a MESSAGE and no code (pgcompat.rpc),
  // so there is no "function not installed" code to branch on any more — and
  // fn_on_leave_today is registered by db/server.ts regardless.
  if (error) fail('getOnLeaveToday: could not load who is on leave', error);
  return ((data ?? []) as any[]).map((r) => ({
    employeeId: r.employee_id,
    name: r.full_name ?? '',
    branch: r.branch ?? '',
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
  }));
}


// ------------------------------------------------------- user tab access ---
/**
 * Which tabs the SIGNED-IN account may open — migration 0045.
 *
 * Only explicit decisions are stored, so a missing entry means "allowed"; see
 * lib/access.ts for the rule that consumes it. The read is scoped to the
 * caller's own account, so it stays a single indexed lookup per portal request.
 *
 * Degrades to an empty map when 0045 has not been applied, which reproduces the
 * behaviour before this feature existed (every tab allowed) rather than locking
 * anyone out of a database that simply has not caught up yet.
 */
export async function getMyTabAccess(userId: string | null): Promise<TabAccess> {
  if (!userId) return {};
  // user_tab_access was a row-per-(user, slug) table. It is now a map embedded
  // on the user document, because the portal layout reads it on EVERY request —
  // as a table that was a second query per page load, and as an embedded field
  // it costs nothing beyond the session lookup that was happening anyway.
  const users = await scoped<UserDoc>(COLLECTIONS.users);
  const user = await users.findOne({ _id: userId }, { projection: { tab_access: 1 } });
  return (user?.tab_access as TabAccess) ?? {};
}
