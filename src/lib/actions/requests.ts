'use server';

import { revalidatePath } from 'next/cache';
import { inclusiveDays, leaveDayCount, stampDutyOnRegister, stampLeaveOnRegister, unstampApprovedDays } from '@/lib/requests/leave-attendance';
import { todayIST } from '@/lib/display-formatting';
import { createClient, createServiceClient } from '@/lib/db/server-client';
import { isMongoConfigured } from '@/lib/db/mongodb-connection';
import { getSession } from '@/lib/server-auth';
import { requireStaff } from '@/lib/actions/guards';
import { releaseCompOff, settleApprovedCompOff } from '@/lib/compensatory-off-settlement';
import { toDecimal } from '@/lib/db/decimal-conversions';
import { notifyApprovers, notifyEmployee } from '@/lib/notification-delivery';
import { requestOverlapProblem, requestStartProblem } from '@/lib/requests/date-rules';
import { notifyRequestParticipants, prepareRequestRouting, reviewRoutedRequest } from '@/lib/requests/routing';
import type { LeaveType, RequestType } from '@/types/database';
import type { RequestRouteDoc } from '@/lib/db/collection-registry';

interface ActionResult {
  ok: boolean;
  error?: string;
  // The decision saved, but a follow-up operation failed. Treat ok: true with a warning as a
  // successful decision requiring attention.
  warning?: string;
  forwarded?: boolean;
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

/** Revalidate every surface a request appears on: the employee's own dashboard,
 *  the staff approvals queue, and the HR dashboard's leave history. */
function revalidateRequestViews(): void {
  // 'layout' is the refresh scope, not a path: /employee and every tab under it.
  revalidatePath('/employee', 'layout');
  revalidatePath('/approvals');
  revalidatePath('/leave-management');
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
  queryClient: Awaited<ReturnType<typeof createClient>>,
  requestId: string,
  decision: 'approved' | 'rejected',
  profileId: string,
  remark: string | null,
): Promise<ChainOutcome> {
  const { data: steps, error } = await queryClient
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

  const rows = steps as Array<{ id: string; step_no: number; status: string }>;
  const current = rows.find((s) => s.status === 'pending');
  if (!current) {
    // Every step already decided — the request should not still be pending.
    return { ok: true, stage: 'final' };
  }

  const { data: claimed, error: claimErr } = await queryClient
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
async function reviewRequest(
  id: string,
  decision: 'approved' | 'rejected',
  /** Approver decision reason, stored on request and displayed to employee. */
  remark?: string,
  nextApproverId?: string,
  revision?: number,
): Promise<ActionResult> {
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, error: 'Choose Approve or Reject.' };
  }

  const cleanRemark =
    String(remark ?? '')
      .trim()
      .slice(0, 500) || null;

  let routed: Awaited<ReturnType<typeof reviewRoutedRequest>>;
  try {
    routed = await reviewRoutedRequest(id, decision, cleanRemark, nextApproverId?.trim(), revision);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not review this request.',
    };
  }
  if (routed.kind === 'forwarded') {
    const route = routed.request.approval_route!;
    const message = `Approved at this stage; awaiting ${route.current_approver.name}'s further approval.`;
    await notifyRequestParticipants(
      id,
      route,
      `Further approval: ${routed.request.employee_name ?? 'Employee'}'s request`,
      message,
    );
    await notifyEmployee(routed.request.employee_id, {
      kind: 'approval',
      title: 'Your request was forwarded for further approval',
      body: message,
      link: `/requests/${id}`,
    });
    revalidateRequestViews();
    revalidatePath(`/requests/${id}`);
    return { ok: true, forwarded: true };
  }

  // The selected colleague may be an employee. Use service access for narrowly scoped follow-up
  // writes only after the guarded request transition succeeds.
  const queryClient = routed.kind === 'final' ? createServiceClient() : await createClient();
  let reviewed: {
    type: string;
    leave_kind?: string | null;
    days: unknown;
    employee_id: string;
    start_date: string;
    end_date: string;
  };
  if (routed.kind === 'final') {
    reviewed = routed.request;
  } else {
    const gate = await requireStaff(`Marking a request ${decision}`);
    if (!gate.ok) {
      return gate;
    }

    // Multi-tier approval chain handling: resolve next pending step or final decision.
    const chain = await decideApprovalStep(queryClient, id, decision, gate.profileId, cleanRemark);
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

    const res = await queryClient
      .from('requests')
      .update({
        status: decision,
        reviewed_by: gate.profileId,
        reviewed_at: new Date(),
        review_remark: cleanRemark,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .is('approval_route', null)
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

    reviewed = data[0] as {
      type: string;
      leave_kind: string | null;
      days: number;
      employee_id: string;
      start_date: string;
      end_date: string;
    };
  }

  // The decision is committed before side effects. Report follow-up failures as warnings; the
  // pending-status guard prevents applying a transition twice.
  let warning: string | null = null;

  // Comp-off: approving spends the credit and stamps the day 'CO'; rejecting
  // releases it back to the employee.
  if (reviewed.type === 'comp_off') {
    if (decision === 'approved') {
      warning = await settleApprovedCompOff(id, queryClient);
    } else {
      await releaseCompOff(id, queryClient);
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
      const { data: bal, error: balReadErr } = await queryClient
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
      const { data: casRows, error: balErr } = await queryClient
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
      queryClient,
      reviewed.employee_id,
      reviewed.start_date,
      reviewed.end_date ?? reviewed.start_date,
    );
    if (stampWarning) {
      warning = warning ? `${warning} ${stampWarning}` : stampWarning;
    }
  }

  // Site visits, outdoor duty and work from home are worked days: stamp them so the register and
  // payroll count them without HR re-entering each one.
  if (decision === 'approved' && reviewed.type !== 'leave' && reviewed.type !== 'comp_off') {
    const stampWarning = await stampDutyOnRegister(
      queryClient,
      reviewed.employee_id,
      reviewed.type,
      reviewed.start_date,
      reviewed.end_date ?? reviewed.start_date,
    );
    if (stampWarning) {
      warning = warning ? `${warning} ${stampWarning}` : stampWarning;
    }
  }

  // Tell the employee the outcome. Look the owner up rather than trusting the
  // caller — the reviewer is not the recipient.
  const { data: owner } = await queryClient
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
      link: '/employee/leave',
    });
  }

  if (routed.kind === 'final' && routed.request.approval_route) {
    await notifyRequestParticipants(
      id,
      routed.request.approval_route,
      `${routed.request.employee_name ?? 'Employee'}'s request was ${decision}`,
      cleanRemark || `${routed.request.start_date} – ${routed.request.end_date}`,
    );
  }

  revalidateRequestViews();
  revalidatePath(`/requests/${id}`);
  if (decision === 'approved') {
    // An approval also changes the register (stamping / comp-off settle) and
    // the leave balances shown on /leave-salary.
    revalidatePath('/monthly-register');
    revalidatePath('/leave-salary');
  }
  // The decision itself succeeded — a side-effect problem is a WARNING on a
  // success, never an ok:false (which screens render as "nothing happened").
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Create a request for the signed-in employee. Derive employee_id from the session; the collection
 * policy also enforces ownership.
 */
async function createRequest(formData: FormData): Promise<ActionResult> {
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
  const startProblem = requestStartProblem(startRaw);
  if (startProblem) {
    return { ok: false, error: startProblem };
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

  const queryClient = await createClient();
  let routing: Awaited<ReturnType<typeof prepareRequestRouting>>;
  try {
    routing = await prepareRequestRouting(formData, employeeId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Choose valid request recipients.',
    };
  }
  // One day cannot carry two requests, such as leave filed twice or leave over a WFH day.
  const overlapProblem = await requestOverlapProblem(queryClient, employeeId, startRaw, endRaw);
  if (overlapProblem) {
    return { ok: false, error: overlapProblem };
  }
  const { data: inserted, error } = await queryClient
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
      ...routing,
    })
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }

  const newId = (inserted?.[0] as { id: string } | undefined)?.id;
  if (!newId) {
    return { ok: false, error: 'The request could not be submitted.' };
  }

  const who = profile?.full_name ?? 'An employee';
  await notifyRequestParticipants(
    newId,
    routing.approval_route,
    `${who} raised a ${type.replace('_', ' ')} request`,
    `${startRaw === endRaw ? startRaw : `${startRaw} – ${endRaw}`} · ${days} day${days === 1 ? '' : 's'}`,
    profile?.id,
  );

  revalidateRequestViews();
  return { ok: true };
}

/**
 * Cancel the caller's own approved request before it starts, and undo what the approval did: the
 * register stamps, the paid-leave deduction, and the comp-off credit. A request that has already
 * started is history on the register and is left to HR.
 */
async function cancelApprovedRequest(
  id: string,
  employeeId: string,
  profileId: string | undefined,
): Promise<ActionResult | null> {
  // The scoped client only lets an employee change a pending request, so this runs with the
  // service client and names the owner and status in every predicate.
  const queryClient = createServiceClient();
  const { data: request } = await queryClient
    .from('requests')
    .select('id, type, leave_kind, days, start_date, end_date, status')
    .eq('id', id)
    .eq('employee_id', employeeId)
    .maybeSingle<{
      type: string;
      leave_kind: string | null;
      days: unknown;
      start_date: string;
      end_date: string;
      status: string;
    }>();
  if (!request || request.status !== 'approved') {
    return null;
  }
  const startDate = String(request.start_date).slice(0, 10);
  const endDate = String(request.end_date ?? request.start_date).slice(0, 10);
  if (startDate < todayIST()) {
    return {
      ok: false,
      error:
        'This request has already started, so it can no longer be cancelled here. Ask HR to correct the register.',
    };
  }

  const { data: cancelled, error } = await queryClient
    .from('requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .select('id, approval_route, employee_name');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!cancelled || cancelled.length === 0) {
    return { ok: false, error: 'The request changed. Refresh and try again.' };
  }

  const warnings: string[] = [];
  if (request.type === 'comp_off') {
    // Approval spent the credit and stamped the day CO; give both back.
    await queryClient
      .from('comp_offs')
      .update({ status: 'available', used_date: null, request_id: null })
      .eq('request_id', id)
      .in('status', ['applied', 'used']);
    const { error: dayError } = await queryClient
      .from('attendance_days')
      .delete()
      .eq('employee_id', employeeId)
      .eq('work_date', startDate)
      .eq('status', 'CO')
      .is('punch_in', null);
    if (dayError) {
      warnings.push(
        `The comp-off day could not be cleared from the register: ${dayError.message}.`,
      );
    }
  } else {
    const unstampWarning = await unstampApprovedDays(
      queryClient,
      employeeId,
      request.type,
      startDate,
      endDate,
    );
    if (unstampWarning) {
      warnings.push(unstampWarning);
    }
  }

  // Paid leave was drawn down on approval; put the days back.
  if (request.type === 'leave' && request.leave_kind && request.leave_kind !== 'LWP') {
    const year = Number(startDate.slice(0, 4));
    let refunded = false;
    for (let attempt = 0; attempt < 3 && !refunded; attempt++) {
      const { data: balance } = await queryClient
        .from('leave_balances')
        .select('id, balance')
        .eq('employee_id', employeeId)
        .eq('year', year)
        .eq('type', request.leave_kind)
        .maybeSingle<{ id: string; balance: number }>();
      if (!balance) {
        break;
      }
      const { data: rows } = await queryClient
        .from('leave_balances')
        .update({ balance: toDecimal(Number(balance.balance) + Number(request.days ?? 0)) })
        .eq('id', balance.id)
        .eq('balance', balance.balance)
        .select('id');
      refunded = !!rows && rows.length > 0;
    }
    if (!refunded) {
      warnings.push(
        `The ${request.leave_kind} balance could not be restored. Ask HR to add the days back.`,
      );
    }
  }

  const row = cancelled[0] as { approval_route?: RequestRouteDoc; employee_name?: string };
  if (row.approval_route) {
    await notifyRequestParticipants(
      id,
      row.approval_route,
      `${row.employee_name ?? 'Employee'} cancelled an approved request`,
      `${startDate === endDate ? startDate : `${startDate} – ${endDate}`} · the approval no longer applies.`,
      profileId,
    );
  }

  revalidateRequestViews();
  revalidatePath(`/requests/${id}`);
  revalidatePath('/monthly-register');
  return warnings.length > 0
    ? { ok: true, warning: `Cancelled. ${warnings.join(' ')}` }
    : { ok: true };
}

/**
 * Withdraw an owned request: a pending one at any time, or an approved one that has not started.
 * Check the returned row so wrong-owner, reviewed, and policy-blocked updates cannot report success.
 */
async function cancelRequest(id: string): Promise<ActionResult> {
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

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .select('id, type, approval_route, employee_name');
  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data || data.length === 0) {
    const approved = await cancelApprovedRequest(id, employeeId, profile?.id);
    if (approved) {
      return approved;
    }
    return {
      ok: false,
      error:
        'The request was not cancelled — it may already have been rejected or cancelled, or your account may not have permission to withdraw it.',
    };
  }

  // Withdrawing a comp-off application returns the credit to the balance.
  if ((data[0] as { type?: string }).type === 'comp_off') {
    await releaseCompOff(id);
  }

  const cancelled = data[0] as { approval_route?: RequestRouteDoc; employee_name?: string };
  if (cancelled.approval_route) {
    await notifyRequestParticipants(
      id,
      cancelled.approval_route,
      `${cancelled.employee_name ?? 'Employee'} cancelled their request`,
      'The applicant withdrew this request. No further approval is needed.',
      profile?.id,
    );
  }

  revalidateRequestViews();
  revalidatePath(`/requests/${id}`);
  return { ok: true };
}

export { reviewRequest, createRequest, cancelRequest };
export type { ActionResult };
