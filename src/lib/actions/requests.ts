'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { isMongoConfigured, getWeekOffPolicy, getHolidays } from '@/lib/queries';
import { countLeaveDays, isScheduledWeekOff } from '@/lib/week-off';
import { getSession } from '@/lib/auth';
import { requireStaff } from '@/lib/actions/guards';
import { releaseCompOff, settleApprovedCompOff } from '@/lib/comp-off-settle';
import { toDecimal } from '@/lib/db/money';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';
import { todayIST } from '@/lib/format';
import type { LeaveType, RequestType } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
  // The decision saved, but a follow-up operation failed. Treat ok: true with a warning as a
  // successful decision requiring attention.
  warning?: string;
}

const requestTypes: readonly RequestType[] = ['leave', 'site_visit', 'outdoor_duty', 'wfh'];
// Paid leave pool; CL/SL retained only for historical record compatibility.
const leaveTypes: readonly LeaveType[] = ['PL', 'LWP', 'CL', 'SL'];

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// Parse a 'YYYY-MM-DD' form value into a UTC-midnight Date, or null if unusable.
function parseISODate(value: string): Date | null {
  if (!isoDate.test(value)) {
    return null;
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  // Reject roll-overs like YYYY-02-31, which Date silently normalises.
  if (d.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return d;
}

/** Inclusive whole-day count between two ISO dates ('16th'..'16th' === 1 day). */
function inclusiveDays(start: Date, end: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}

/**
 * Load holiday and week-off rules for countLeaveDays. Other request types use the calendar span. If
 * policy reads fail, leave requests also fall back to the calendar span.
 */
async function leaveDayCount(
  startISO: string,
  endISO: string,
  start: Date,
  end: Date,
): Promise<number> {
  try {
    const [policy, holidays, sandwich] = await Promise.all([
      getWeekOffPolicy(),
      getHolidays(),
      getSandwichPolicy(),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const days = countLeaveDays(startISO, endISO, { policy, holidays: holidaySet, sandwich });
    // A span of only non-working days costs nothing to take, but a zero-day
    // request is not a thing the rest of the system can reason about — reject it
    // in the caller rather than storing 0.
    return days;
  } catch {
    return inclusiveDays(start, end);
  }
}

/** The configurable sandwich-leave toggle, from the settings collection. */
async function getSandwichPolicy(): Promise<boolean> {
  try {
    const dbc = await createClient();
    const { data } = await dbc
      .from('settings')
      .select('value')
      .eq('key', 'leave_sandwich_policy')
      .maybeSingle<{ value: unknown }>();
    return data?.value === true || data?.value === 'true';
  } catch {
    return false;
  }
}

/** Revalidate every surface a request appears on: the employee's own dashboard,
 *  the staff approvals queue, and the HR dashboard's leave history. */
function revalidateRequestViews(): void {
  revalidatePath('/me');
  revalidatePath('/approvals');
  revalidatePath('/leave-management');
}

/** Every 'YYYY-MM-DD' in an inclusive span (small spans only — capped upstream). */
function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return out;
  }
  while (cursor.getTime() <= end.getTime() && out.length < 1000) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Stamp approved leave only where attendance is missing or AB. Preserve recorded presence and
 * existing off-day stamps, and skip unrecorded holidays and week-offs. Return locked-month skips as
 * warnings because the approval has already saved.
 */
async function stampLeaveOnRegister(
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  startISO: string,
  endISO: string,
): Promise<string | null> {
  const days = enumerateDays(startISO, endISO);
  if (days.length === 0) {
    return null;
  }

  let policy: Awaited<ReturnType<typeof getWeekOffPolicy>>;
  let holidaySet: Set<string>;
  try {
    const [p, holidays] = await Promise.all([getWeekOffPolicy(), getHolidays()]);
    policy = p;
    holidaySet = new Set(holidays.map((h) => h.date));
  } catch (e) {
    return `Approved, but the register could not be stamped (week-off policy unreadable: ${
      e instanceof Error ? e.message : String(e)
    }). Mark the day(s) L from the register.`;
  }

  const { data: existing, error: readErr } = await dbc
    .from('attendance_days')
    .select('work_date, status')
    .eq('employee_id', employeeId)
    .gte('work_date', days[0])
    .lte('work_date', days[days.length - 1]);
  if (readErr) {
    return `Approved, but the register could not be read to stamp the leave: ${readErr.message}. Mark the day(s) L from the register.`;
  }
  const statusByDate = new Map<string, string>();
  for (const row of (existing ?? []) as { work_date: string; status: string }[]) {
    statusByDate.set(row.work_date, row.status);
  }

  // Check each involved month's payroll state once, not per day.
  const lockedMonths = new Set<string>();
  for (const month of new Set(days.map((d) => d.slice(0, 7)))) {
    const gate = await requireOpenPayrollMonthShim(dbc, `${month}-01`);
    if (!gate.ok) {
      lockedMonths.add(month);
    }
  }

  const toUpdate: string[] = []; // existing 'AB' rows
  const toInsert: string[] = []; // no row at all
  const skippedLocked: string[] = [];
  for (const day of days) {
    if (lockedMonths.has(day.slice(0, 7))) {
      skippedLocked.push(day);
      continue;
    }
    const status = statusByDate.get(day);
    if (status === 'AB') {
      toUpdate.push(day);
    } else if (status == null && !isScheduledWeekOff(day, policy) && !holidaySet.has(day)) {
      toInsert.push(day);
    }
  }

  const problems: string[] = [];
  if (toUpdate.length > 0) {
    const { error } = await dbc
      .from('attendance_days')
      .update({ status: 'L' })
      .eq('employee_id', employeeId)
      .eq('status', 'AB')
      .in('work_date', toUpdate);
    if (error) {
      problems.push(`could not restamp AB day(s): ${error.message}`);
    }
  }
  if (toInsert.length > 0) {
    const { error } = await dbc
      .from('attendance_days')
      .insert(toInsert.map((work_date) => ({ employee_id: employeeId, work_date, status: 'L' })));
    // Ignore duplicate key conflicts if stamped concurrently.
    if (error && error.code !== '23505') {
      problems.push(`could not add L day(s): ${error.message}`);
    }
  }
  if (skippedLocked.length > 0) {
    problems.push(
      `payroll for ${[...lockedMonths].join(', ')} is closed, so ${skippedLocked.length} day(s) were not stamped`,
    );
  }
  return problems.length > 0
    ? `Approved, but the register was only partially stamped: ${problems.join('; ')}.`
    : null;
}

/** Local month gate — mirrors requireOpenPayrollMonth but never throws. */
async function requireOpenPayrollMonthShim(
  dbc: Awaited<ReturnType<typeof createClient>>,
  periodMonth: string,
): Promise<{ ok: boolean }> {
  const { data, error } = await dbc
    .from('payroll_runs')
    .select('status, month_closed_at')
    .eq('period_month', periodMonth)
    // month_closed_at is a BSON date; only its presence is tested below.
    .maybeSingle<{ status: string; month_closed_at: Date | null }>();
  if (error) {
    // fail closed — don't stamp a month we can't check
    return { ok: false };
  }
  if (data?.status === 'locked' || data?.status === 'paid') {
    return { ok: false };
  }
  if (data?.month_closed_at) {
    return { ok: false };
  }
  return { ok: true };
}

type ChainOutcome =
  | { ok: true; stage: 'none' }
  | { ok: true; stage: 'final'; decidedStep?: number }
  | { ok: true; stage: 'intermediate'; decidedStep: number; nextStep: number }
  | { ok: false; error: string };

/**
 * Decide one pending approval step. Return none without a chain, intermediate while steps remain,
 * or final for the overall decision. A conditional update prevents concurrent decisions.
 */
async function decideApprovalStep(
  dbc: Awaited<ReturnType<typeof createClient>>,
  requestId: string,
  decision: 'approved' | 'rejected',
  profileId: string,
  remark: string | null,
): Promise<ChainOutcome> {
  const { data: steps, error } = await dbc
    .from('approval_steps')
    .select('id, step_no, status')
    .eq('request_id', requestId)
    .order('step_no', { ascending: true });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!steps || steps.length === 0) {
    return { ok: true, stage: 'none' };
  }

  const rows = steps as { id: string; step_no: number; status: string }[];
  const current = rows.find((s) => s.status === 'pending');
  if (!current) {
    // Every step already decided — the request should not still be pending.
    return { ok: true, stage: 'final' };
  }

  const { data: claimed, error: claimErr } = await dbc
    .from('approval_steps')
    .update({
      status: decision,
      approver_id: profileId,
      decided_at: new Date(),
      remark,
    })
    .eq('id', current.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) {
    return { ok: false, error: claimErr.message };
  }
  if (!claimed || claimed.length === 0) {
    return {
      ok: false,
      error: 'That approval step was just decided by someone else. Reload the queue.',
    };
  }

  // A rejection at ANY level ends the chain — the request is rejected outright.
  if (decision === 'rejected') {
    return { ok: true, stage: 'final', decidedStep: current.step_no };
  }

  const next = rows.find((s) => s.step_no > current.step_no && s.status === 'pending');
  return next
    ? { ok: true, stage: 'intermediate', decidedStep: current.step_no, nextStep: next.step_no }
    : { ok: true, stage: 'final', decidedStep: current.step_no };
}

/**
 * Decide a pending request. Select the updated row to distinguish a saved decision from an
 * already-reviewed or policy-blocked request.
 */
export async function reviewRequest(
  id: string,
  decision: 'approved' | 'rejected',
  /** Approver decision reason, stored on request and displayed to employee. */
  remark?: string,
): Promise<ActionResult> {
  // Staff-only, DB required. requireStaff also covers the no-database refusal.
  const gate = await requireStaff(`Marking a request ${decision}`);
  if (!gate.ok) {
    return gate;
  }

  const cleanRemark =
    String(remark ?? '')
      .trim()
      .slice(0, 500) || null;

  const dbc = await createClient();

  // Multi-tier approval chain handling: resolve next pending step or final decision.
  const chain = await decideApprovalStep(dbc, id, decision, gate.profileId, cleanRemark);
  if (!chain.ok) {
    return { ok: false, error: chain.error };
  }
  if (chain.stage === 'intermediate') {
    // More approvals to go: the request stays pending on purpose.
    await notifyApprovers(
      {
        kind: 'approval',
        title: `A request needs approval step ${chain.nextStep}`,
        body: `Step ${chain.decidedStep} approved. Awaiting the next approver.`,
        link: '/approvals',
      },
      gate.profileId,
    );
    revalidateRequestViews();
    return { ok: true };
  }

  const res = await dbc
    .from('requests')
    .update({
      status: decision,
      reviewed_by: gate.profileId,
      reviewed_at: new Date(),
      review_remark: cleanRemark,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, type, leave_kind, days, employee_id, start_date, end_date');
  const { data, error } = res;
  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'The request was not updated — it may already have been reviewed by someone else, or your account may not have permission to review it.',
    };
  }

  const reviewed = data[0] as {
    type: string;
    leave_kind: string | null;
    days: number;
    employee_id: string;
    start_date: string;
    end_date: string;
  };

  // The decision is committed before side effects. Report follow-up failures as warnings; the
  // pending-status guard prevents applying a transition twice.
  let warning: string | null = null;

  // Comp-off: approving spends the credit and stamps the day 'CO'; rejecting
  // releases it back to the employee.
  if (reviewed.type === 'comp_off') {
    if (decision === 'approved') {
      warning = await settleApprovedCompOff(id);
    } else {
      await releaseCompOff(id);
    }
  }

  // Leave: approving a paid leave (PL/CL/SL — not LWP) draws it down from the
  // employee's yearly balance. Rejecting deducts nothing (the balance is only
  // spent on approval).
  if (
    reviewed.type === 'leave' &&
    decision === 'approved' &&
    reviewed.leave_kind &&
    reviewed.leave_kind !== 'LWP'
  ) {
    const year = Number(reviewed.start_date.slice(0, 4));
    // Deduct only if the balance still matches the value read. Retry concurrent changes to
    // preserve each deduction.
    let deducted = false;
    for (let attempt = 0; attempt < 3 && !deducted; attempt++) {
      const { data: bal, error: balReadErr } = await dbc
        .from('leave_balances')
        .select('id, balance')
        .eq('employee_id', reviewed.employee_id)
        .eq('year', year)
        .eq('type', reviewed.leave_kind)
        .maybeSingle<{ id: string; balance: number }>();
      if (balReadErr) {
        warning = `Approved, but the ${reviewed.leave_kind} balance could not be read: ${balReadErr.message}`;
        break;
      }
      if (!bal) {
        // No balance row for this kind/year. The approval still stands
        // (refusing it would strand HR mid-flow), but say so loudly.
        warning =
          `Approved, but ${reviewed.leave_kind} has no balance on record for ${year}, so nothing was deducted. ` +
          `Provision the leave year from the Leave salary page so entitlements are tracked.`;
        break;
      }
      const next = Number(bal.balance) - Number(reviewed.days ?? 0);
      const { data: casRows, error: balErr } = await dbc
        .from('leave_balances')
        .update({ balance: toDecimal(next) })
        .eq('id', bal.id)
        // Compare against the stored value exactly; rounding or converting it can break the
        // conditional update.
        .eq('balance', bal.balance)
        .select('id');
      if (balErr) {
        warning = `Approved, but the ${reviewed.leave_kind} balance could not be updated: ${balErr.message}`;
        break;
      }
      if (casRows && casRows.length > 0) {
        deducted = true;
        if (next < 0) {
          // Approving past zero is allowed (HR sometimes must), but it is never
          // silent — an overdrawn balance is a payroll problem later.
          warning =
            `Approved, but this takes ${reviewed.leave_kind} to ${next} day(s) — the balance is now overdrawn. ` +
            `Correct it from the Leave salary page, or convert the excess to LWP.`;
        }
      } else if (attempt === 2) {
        warning = `Approved, but the ${reviewed.leave_kind} balance was contended and could not be updated. Adjust it from the Leave salary page.`;
      }
    }
  }

  // Update attendance after approval so the register reflects the leave.
  if (reviewed.type === 'leave' && decision === 'approved') {
    const stampWarning = await stampLeaveOnRegister(
      dbc,
      reviewed.employee_id,
      reviewed.start_date,
      reviewed.end_date ?? reviewed.start_date,
    );
    if (stampWarning) {
      warning = warning ? `${warning} ${stampWarning}` : stampWarning;
    }
  }

  // Tell the employee the outcome. Look the owner up rather than trusting the
  // caller — the reviewer is not the recipient.
  const { data: owner } = await dbc
    .from('requests')
    .select('employee_id, type, start_date, end_date')
    .eq('id', id)
    .maybeSingle<{ employee_id: string; type: string; start_date: string; end_date: string }>();
  if (owner) {
    const span =
      owner.start_date === owner.end_date
        ? owner.start_date
        : `${owner.start_date} – ${owner.end_date}`;
    await notifyEmployee(owner.employee_id, {
      kind: 'approval',
      title: `Your ${owner.type.replace('_', ' ')} request was ${decision}`,
      body: cleanRemark ? `${span} — “${cleanRemark}”` : span,
      link: '/me#leave',
    });
  }

  revalidateRequestViews();
  if (decision === 'approved') {
    // An approval also changes the register (stamping / comp-off settle) and
    // the leave balances shown on /leave.
    revalidatePath('/register');
    revalidatePath('/leave');
  }
  // The decision itself succeeded — a side-effect problem is a WARNING on a
  // success, never an ok:false (which screens render as "nothing happened").
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Create a request for the signed-in employee. Derive employee_id from the session; the collection
 * policy also enforces ownership.
 */
export async function createRequest(formData: FormData): Promise<ActionResult> {
  // validate the form before touching auth or the network
  const type = String(formData.get('type') ?? '').trim() as RequestType;
  if (!requestTypes.includes(type)) {
    return { ok: false, error: 'Pick a request type.' };
  }

  // leave_kind is applicable only when type is 'leave'.
  let leaveKind: LeaveType | null = null;
  if (type === 'leave') {
    const raw = String(formData.get('leave_kind') ?? '').trim() as LeaveType;
    if (!leaveTypes.includes(raw)) {
      return { ok: false, error: 'Pick a leave type (Paid leave / Leave without pay).' };
    }
    leaveKind = raw;
  }

  const startRaw = String(formData.get('start_date') ?? '').trim();
  const endRaw = String(formData.get('end_date') ?? '').trim();
  const start = parseISODate(startRaw);
  const end = parseISODate(endRaw);
  if (!start) {
    return { ok: false, error: 'Enter a valid start date.' };
  }
  if (!end) {
    return { ok: false, error: 'Enter a valid end date.' };
  }
  // Requests must start today or later in IST. HR handles retrospective changes through the
  // attendance register.
  if (startRaw < todayIST()) {
    return { ok: false, error: 'The start date has already passed — pick today or a later day.' };
  }
  // Allow equal dates for a single-day request.
  if (end.getTime() < start.getTime()) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  // Leave is costed against the week-off/holiday calendar (and the sandwich
  // policy); other request types keep the plain calendar span.
  const days =
    type === 'leave'
      ? await leaveDayCount(startRaw, endRaw, start, end)
      : inclusiveDays(start, end);

  if (type === 'leave' && days <= 0) {
    return {
      ok: false,
      error:
        'Those dates are all week-offs or holidays, so there is no working day to take leave on.',
    };
  }
  // Validate day count within bounds before persistence.
  if (days > 999) {
    return { ok: false, error: 'That range is too long to submit as a single request.' };
  }

  const reason = String(formData.get('reason') ?? '').trim() || null;

  // a write with no database is a failure, not a success
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error:
        'The database is not configured, so this request cannot be saved. Nothing was submitted.',
    };
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return {
      ok: false,
      error:
        'Your login is not linked to an employee record, so requests cannot be filed. Ask HR to link it.',
    };
  }

  const dbc = await createClient();
  const { data: inserted, error } = await dbc
    .from('requests')
    .insert({
      employee_id: employeeId,
      type,
      leave_kind: leaveKind,
      start_date: startRaw,
      end_date: endRaw,
      // `decimal` column — see toDecimal(). Filing any request at all failed
      // on the validator while this was a plain number.
      days: toDecimal(days),
      reason,
      status: 'pending',
    })
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }

  // Initialize multi-tier approval chain if configured (best-effort).
  const newId = (inserted?.[0] as { id: string } | undefined)?.id;
  if (newId) {
    const { error: chainErr } = await dbc.rpc('fn_init_approval_steps', { p_request_id: newId });
    if (chainErr) {
      console.warn('[dalnex-hrms] approval chain seed failed:', chainErr.message);
    }
  }

  // Put it in front of the approvers rather than waiting for them to check.
  const who = profile?.full_name ?? 'An employee';
  await notifyApprovers(
    {
      kind: 'request',
      title: `${who} raised a ${type.replace('_', ' ')} request`,
      body: `${startRaw === endRaw ? startRaw : `${startRaw} – ${endRaw}`} · ${days} day${days === 1 ? '' : 's'}`,
      link: '/approvals',
    },
    profile?.id,
  );

  revalidateRequestViews();
  return { ok: true };
}

/**
 * Withdraw an owned, pending request. Check the returned row so wrong-owner, reviewed, and
 * policy-blocked updates cannot report success.
 */
export async function cancelRequest(id: string): Promise<ActionResult> {
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: 'The database is not configured, so this request cannot be cancelled.',
    };
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record.' };
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .select('id, type');
  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'The request was not cancelled — it may already have been reviewed, or your account may not have permission to withdraw it.',
    };
  }

  // Withdrawing a comp-off application returns the credit to the balance.
  if ((data[0] as { type?: string }).type === 'comp_off') {
    await releaseCompOff(id);
  }

  revalidateRequestViews();
  return { ok: true };
}
