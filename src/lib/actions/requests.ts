'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, getWeekOffPolicy, getHolidays } from '@/lib/queries';
import { countLeaveDays, isScheduledWeekOff } from '@/lib/week-off';
import { getSession } from '@/lib/auth';
import { requireStaff } from '@/lib/actions/_guard';
import { releaseCompOff, settleApprovedCompOff } from '@/lib/compoff-settle';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';
import type { LeaveType, RequestType } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /**
   * The decision SUCCEEDED but a side-effect needs attention (balance not
   * found, register not stamped, …). Callers must treat ok:true+warning as a
   * success with a message — the old shape returned ok:false for these, which
   * made screens render a completed approval as if it had failed.
   */
  warning?: string;
}

const REQUEST_TYPES: readonly RequestType[] = ['leave', 'site_visit', 'outdoor_duty', 'wfh'];
// One paid-leave pool since the leave-salary policy (0038). CL/SL stay in the
// enum for historic rows but a new request may no onger carry them.
const LEAVE_TYPES: readonly LeaveType[] = ['PL', 'LWP', 'CL', 'SL'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a 'YYYY-MM-DD' form value into a UTC-midnight Date, or null if unusable. */
function parseISODate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject roll-overs like 2026-02-31, which Date silently normalises.
  if (d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

/** Inclusive whole-day count between two ISO dates ('16th'..'16th' === 1 day). */
function inclusiveDays(start: Date, end: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

/**
 * How many days a LEAVE request actually costs.
 *
 * A raw calendar span over-charges (a Fri–Mon leave is 2 working days, not 4)
 * and, with the sandwich policy on, under-charges the bridged weekend. Both are
 * decided by `countLeaveDays`; this just loads the policy + holidays it needs.
 *
 * Non-leave request types (site visit, outdoor duty, WFH) keep the plain calendar
 * span — they are not drawn from a balance, so bridging would be meaningless.
 *
 * Falls back to the calendar span if the settings/holidays reads fail: a request
 * that cannot be filed at all is worse than one costed slightly generously.
 */
async function leaveDayCount(startISO: string, endISO: string, start: Date, end: Date): Promise<number> {
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

/** The configurable sandwich-leave toggle (settings key seeded by 0036). */
async function getSandwichPolicy(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
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
  revalidatePath('/hr');
}

/** Every 'YYYY-MM-DD' in an inclusive span (small spans only — capped upstream). */
function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return out;
  while (cursor.getTime() <= end.getTime() && out.length < 1000) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Stamp an approved leave onto the register as 'L'.
 *
 * Fills ONLY genuine gaps — days with no attendance row, or rows marked 'AB' —
 * exactly the days getLeaveRegisterMismatches flags. A day the register already
 * covers (WO/OH/CO/L) or shows real presence (P/HD/LM/S/T) is never overwritten:
 * an approved leave must not erase evidence that someone actually worked.
 * Scheduled week-offs and holidays inside the span are skipped when they have
 * no row, so a Sunday never becomes 'L'.
 *
 * Locked/paid months are refused day-by-day (the leave may straddle a month
 * boundary); refused days come back as a warning, never an error — the approval
 * itself already stands.
 */
async function stampLeaveOnRegister(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  startISO: string,
  endISO: string,
): Promise<string | null> {
  const days = enumerateDays(startISO, endISO);
  if (days.length === 0) return null;

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

  const { data: existing, error: readErr } = await supabase
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
    const gate = await requireOpenPayrollMonthShim(supabase, `${month}-01`);
    if (!gate.ok) lockedMonths.add(month);
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
    if (status === 'AB') toUpdate.push(day);
    else if (status == null && !isScheduledWeekOff(day, policy) && !holidaySet.has(day)) {
      toInsert.push(day);
    }
  }

  const problems: string[] = [];
  if (toUpdate.length > 0) {
    const { error } = await supabase
      .from('attendance_days')
      .update({ status: 'L' })
      .eq('employee_id', employeeId)
      .eq('status', 'AB')
      .in('work_date', toUpdate);
    if (error) problems.push(`could not restamp AB day(s): ${error.message}`);
  }
  if (toInsert.length > 0) {
    const { error } = await supabase
      .from('attendance_days')
      .insert(toInsert.map((work_date) => ({ employee_id: employeeId, work_date, status: 'L' })));
    // 23505 = someone stamped the day concurrently — that is fine, not a problem.
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodMonth: string,
): Promise<{ ok: boolean }> {
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('status, month_closed_at')
    .eq('period_month', periodMonth)
    .maybeSingle<{ status: string; month_closed_at: string | null }>();
  if (error) return { ok: false }; // fail closed — don't stamp a month we can't check
  if (data?.status === 'locked' || data?.status === 'paid') return { ok: false };
  if (data?.month_closed_at) return { ok: false };
  return { ok: true };
}

type ChainOutcome =
  | { ok: true; stage: 'none' }
  | { ok: true; stage: 'final'; decidedStep?: number }
  | { ok: true; stage: 'intermediate'; decidedStep: number; nextStep: number }
  | { ok: false; error: string };

/**
 * Decide the current step of a request's approval chain.
 *
 * Returns 'none' when the request has no chain (nothing to do — the caller keeps
 * its original one-shot behaviour), 'intermediate' when more approvals remain,
 * and 'final' when this decision should carry the whole request.
 *
 * The step UPDATE is predicated on `status = 'pending'`, so two approvers racing
 * on the same step cannot both claim it — the loser is told, exactly as the
 * request-level guard does.
 */
async function decideApprovalStep(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requestId: string,
  decision: 'approved' | 'rejected',
  profileId: string,
  remark: string | null,
): Promise<ChainOutcome> {
  const { data: steps, error } = await supabase
    .from('approval_steps')
    .select('id, step_no, status')
    .eq('request_id', requestId)
    .order('step_no', { ascending: true });

  // No chain table (0036 unapplied) or no rows for this request: original path.
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: true, stage: 'none' };
    return { ok: false, error: error.message };
  }
  if (!steps || steps.length === 0) return { ok: true, stage: 'none' };

  const rows = steps as { id: string; step_no: number; status: string }[];
  const current = rows.find((s) => s.status === 'pending');
  if (!current) {
    // Every step already decided — the request should not still be pending.
    return { ok: true, stage: 'final' };
  }

  const { data: claimed, error: claimErr } = await supabase
    .from('approval_steps')
    .update({
      status: decision,
      approver_id: profileId,
      decided_at: new Date().toISOString(),
      remark,
    })
    .eq('id', current.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    return {
      ok: false,
      error: 'That approval step was just decided by someone else. Reload the queue.',
    };
  }

  // A rejection at ANY level ends the chain — the request is rejected outright.
  if (decision === 'rejected') return { ok: true, stage: 'final', decidedStep: current.step_no };

  const next = rows.find((s) => s.step_no > current.step_no && s.status === 'pending');
  return next
    ? { ok: true, stage: 'intermediate', decidedStep: current.step_no, nextStep: next.step_no }
    : { ok: true, stage: 'final', decidedStep: current.step_no };
}

/**
 * Approve or reject a pending leave / duty request.
 *
 * `status='pending'` is part of the predicate so two reviewers racing on the
 * same request cannot silently overwrite each other's decision — the loser gets
 * an error instead of a green tick. As in `cancelRequest`, the updated rows are
 * selected back because RLS-blocked and already-reviewed updates both match zero
 * rows, which PostgREST reports as a success rather than an error.
 */
export async function reviewRequest(
  id: string,
  decision: 'approved' | 'rejected',
  /** The approver's reason (0041) — stored on the request, shown to the employee. */
  remark?: string,
): Promise<ActionResult> {
  // Staff-only, DB required. requireStaff also covers the no-database refusal.
  const gate = await requireStaff(`Marking a request ${decision}`);
  if (!gate.ok) return gate;

  const cleanRemark = String(remark ?? '').trim().slice(0, 500) || null;

  const supabase = await createClient();

  // --- approval chain (0036) ------------------------------------------------
  // A request may carry an ordered chain of approval_steps. Decide the LOWEST
  // pending step; the request itself only moves when that step is the last one
  // (or on any rejection, which ends the chain immediately).
  //
  // A request with NO steps — anything filed before 0036, or with the levels
  // setting at 1 and the seed skipped — falls straight through to the original
  // one-shot path, so in-flight approvals cannot break.
  const chain = await decideApprovalStep(supabase, id, decision, gate.profileId, cleanRemark);
  if (!chain.ok) return { ok: false, error: chain.error };
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

  let res = await supabase
    .from('requests')
    .update({
      status: decision,
      reviewed_by: gate.profileId,
      reviewed_at: new Date().toISOString(),
      review_remark: cleanRemark,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, type, leave_kind, days, employee_id, start_date, end_date');
  // review_remark arrives with 0041 — decide without it until it is applied.
  if (res.error?.code === 'PGRST204' || res.error?.code === '42703') {
    res = (await supabase
      .from('requests')
      .update({ status: decision, reviewed_by: gate.profileId, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, type, leave_kind, days, employee_id, start_date, end_date')) as typeof res;
  }
  const { data, error } = res;
  if (error) return { ok: false, error: error.message };

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

  // Side-effects run after the decision is committed. A side-effect failure is
  // reported as a warning rather than reverting a saved approval. The pending
  // guard above means each transition (and its side-effect) fires at most once,
  // so a leave balance can't be double-deducted by re-approving.
  let warning: string | null = null;

  // Comp-off: approving spends the credit and stamps the day 'CO'; rejecting
  // releases it back to the employee.
  if (reviewed.type === 'comp_off') {
    if (decision === 'approved') warning = await settleApprovedCompOff(id);
    else await releaseCompOff(id);
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
    // Compare-and-swap drawdown: the UPDATE is predicated on the balance we
    // read, so two approvals racing on the same employee cannot both apply
    // against the same starting balance — the loser re-reads and retries.
    // (A plain read-modify-write silently lost one deduction.)
    let deducted = false;
    for (let attempt = 0; attempt < 3 && !deducted; attempt++) {
      const { data: bal, error: balReadErr } = await supabase
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
      const { data: casRows, error: balErr } = await supabase
        .from('leave_balances')
        .update({ balance: next })
        .eq('id', bal.id)
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

  // Stamp the register so the approved leave and the attendance sheet cannot
  // silently diverge (the /register mismatch card exists because they used to).
  if (reviewed.type === 'leave' && decision === 'approved') {
    const stampWarning = await stampLeaveOnRegister(
      supabase,
      reviewed.employee_id,
      reviewed.start_date,
      reviewed.end_date ?? reviewed.start_date,
    );
    if (stampWarning) warning = warning ? `${warning} ${stampWarning}` : stampWarning;
  }

  // Tell the employee the outcome. Look the owner up rather than trusting the
  // caller — the reviewer is not the recipient.
  const { data: owner } = await supabase
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
 * Raise a leave / duty request for the signed-in employee.
 *
 * Employee-only: the employee_id comes from the session profile, never from the
 * form, so one employee cannot file against another. RLS policy
 * `requests_employee_insert` (migration 0004) enforces the same rule server-side.
 */
export async function createRequest(formData: FormData): Promise<ActionResult> {
  // --- validate the form before touching auth or the network -----------------
  const type = String(formData.get('type') ?? '').trim() as RequestType;
  if (!REQUEST_TYPES.includes(type)) {
    return { ok: false, error: 'Pick a request type.' };
  }

  // leave_kind is meaningful only for type='leave' (see the 0001 column comment).
  let leaveKind: LeaveType | null = null;
  if (type === 'leave') {
    const raw = String(formData.get('leave_kind') ?? '').trim() as LeaveType;
    if (!LEAVE_TYPES.includes(raw)) {
      return { ok: false, error: 'Pick a leave type (Paid leave / Leave without pay).' };
    }
    leaveKind = raw;
  }

  const startRaw = String(formData.get('start_date') ?? '').trim();
  const endRaw = String(formData.get('end_date') ?? '').trim();
  const start = parseISODate(startRaw);
  const end = parseISODate(endRaw);
  if (!start) return { ok: false, error: 'Enter a valid start date.' };
  if (!end) return { ok: false, error: 'Enter a valid end date.' };
  if (end.getTime() < start.getTime()) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  // Leave is costed against the week-off/holiday calendar (and the sandwich
  // policy); other request types keep the plain calendar span.
  const days =
    type === 'leave' ? await leaveDayCount(startRaw, endRaw, start, end) : inclusiveDays(start, end);

  if (type === 'leave' && days <= 0) {
    return {
      ok: false,
      error: 'Those dates are all week-offs or holidays, so there is no working day to take leave on.',
    };
  }
  // requests.days is numeric(4,1) — cap the range rather than let Postgres
  // reject it with an opaque overflow error.
  if (days > 999) {
    return { ok: false, error: 'That range is too long to submit as a single request.' };
  }

  const reason = String(formData.get('reason') ?? '').trim() || null;

  // --- a write with no database is a failure, not a success ------------------
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Supabase is not configured, so this request cannot be saved. Nothing was submitted.',
    };
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return {
      ok: false,
      error: 'Your login is not linked to an employee record, so requests cannot be filed. Ask HR to link it.',
    };
  }

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from('requests')
    .insert({
      employee_id: employeeId,
      type,
      leave_kind: leaveKind,
      start_date: startRaw,
      end_date: endRaw,
      days,
      reason,
      status: 'pending',
    })
    .select('id');
  if (error) return { ok: false, error: error.message };

  // Seed the approval chain (0036). BEST-EFFORT: with the levels setting at 1 —
  // or the function absent — this is a no-op and reviewRequest falls back to the
  // original single-step path, so a failure here never blocks a filed request.
  const newId = (inserted?.[0] as { id: string } | undefined)?.id;
  if (newId) {
    const { error: chainErr } = await supabase.rpc('fn_init_approval_steps', { p_request_id: newId });
    if (chainErr && chainErr.code !== 'PGRST202' && chainErr.code !== '42883') {
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
 * Withdraw one of your own still-pending requests.
 *
 * The `employee_id` / `status` predicates are belt-and-braces: they scope the
 * write even if RLS is permissive. We ask for the updated rows back so a
 * no-op UPDATE (wrong owner, already reviewed, or blocked by RLS — all of which
 * PostgREST reports as a silent success) is surfaced as an error instead of a
 * green tick over an unchanged row.
 */
export async function cancelRequest(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Supabase is not configured, so this request cannot be cancelled.',
    };
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .select('id, type');
  if (error) return { ok: false, error: error.message };

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'The request was not cancelled — it may already have been reviewed, or your account may not have permission to withdraw it.',
    };
  }

  // Withdrawing a comp-off application returns the credit to the balance.
  if ((data[0] as { type?: string }).type === 'comp_off') await releaseCompOff(id);

  revalidateRequestViews();
  return { ok: true };
}
