'use server';

// Exit stages: initiated → clearance → settlement → completed. Disable the login only at completion
// so the employee retains access during clearance and settlement.
import { queryErrorCodes } from '@/lib/db/query-errors';
import { revalidatePath } from 'next/cache';
import { todayIST } from '@/lib/display-formatting';
import { isCalendarDate } from '@/lib/calendar-dates';
import { toMoney } from '@/lib/db/decimal-conversions';
import { notifyEmployee } from '@/lib/notification-delivery';
import { createClient } from '@/lib/db/server-client';
import { deactivateEmployee } from '@/lib/actions/employees';
import { requireRoles, wroteNothing } from '@/lib/actions/guards';
import { getClearanceItems as readClearanceItems, getExitInterview as readExitInterview, getKtItems as readKtItems } from '@/lib/queries/exits';
import type { ExitInterviewRow } from '@/lib/queries/exits';
import type { AppRole } from '@/types/database';

interface ActionResult {
  ok: boolean;
  error?: string;
  // The action SUCCEEDED but a follow-up needs attention. ok stays true.
  warning?: string;
}

const exitRoles: AppRole[] = ['super_admin', 'admin', 'hr'];
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Current date in India Standard Time (IST) to match the official business day.
function today(): string {
  return todayIST();
}

/** Initiates an exit case and updates employee status to `on_notice`. */
async function initiateExit(input: {
  employeeId: string;
  resignationDate: string;
  lastWorkingDay: string;
  reason?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Starting an exit');
  if (!gate.ok) {
    return gate;
  }

  if (!uuidRe.test(String(input.employeeId ?? ''))) {
    return { ok: false, error: 'Pick an employee.' };
  }
  if (!isCalendarDate(input.resignationDate)) {
    return { ok: false, error: 'Enter the resignation date.' };
  }
  if (!isCalendarDate(input.lastWorkingDay)) {
    return { ok: false, error: 'Enter the last working day.' };
  }
  if (input.resignationDate > today()) {
    return {
      ok: false,
      error: 'The resignation date is in the future — record the exit once notice is given.',
    };
  }
  if (input.lastWorkingDay < input.resignationDate) {
    return { ok: false, error: 'The last working day cannot be before the resignation date.' };
  }

  const queryClient = await createClient();

  // On-notice employees appear in the employee picker, so an exit already under way has to be
  // refused here rather than by leaving them out of the list.
  const { data: openCases, error: openError } = await queryClient
    .from('exit_cases')
    .select('id')
    .eq('employee_id', input.employeeId)
    .neq('stage', 'completed')
    .limit(1);
  if (openError) {
    return { ok: false, error: openError.message };
  }
  if (openCases && openCases.length > 0) {
    return { ok: false, error: 'This employee already has an exit in progress.' };
  }

  const { data, error } = await queryClient
    .from('exit_cases')
    .insert({
      employee_id: input.employeeId,
      stage: 'initiated',
      resignation_date: input.resignationDate,
      last_working_day: input.lastWorkingDay,
      reason: String(input.reason ?? '').trim() || null,
      created_by: gate.profileId,
    })
    .select('id');

  if (error) {
    // Unique constraint: only one active exit case permitted per employee.
    if (error.code === queryErrorCodes.duplicateKey) {
      return { ok: false, error: 'This employee already has an exit in progress.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The exit was not started — your role may lack permission.' };
  }

  // Keep the login active while marking the employee on notice. Report a failed roster update as a
  // warning because the exit case is already saved.
  const noticeDays = Math.round(
    (Date.parse(`${input.lastWorkingDay}T00:00:00Z`) -
      Date.parse(`${input.resignationDate}T00:00:00Z`)) /
      86_400_000,
  );
  const { data: mirrored, error: mirrorErr } = await queryClient
    .from('employees')
    .update({
      status: 'on_notice',
      resignation_date: input.resignationDate,
      last_working_day: input.lastWorkingDay,
      notice_period_days: Number.isFinite(noticeDays) ? noticeDays : null,
      exit_reason: String(input.reason ?? '').trim() || null,
    })
    .eq('id', input.employeeId)
    .select('id');
  const mirrorProblem = mirrorErr
    ? `the employee could not be marked on notice: ${mirrorErr.message}`
    : wroteNothing(mirrored)
      ? 'the employee could not be marked on notice (no row was updated)'
      : null;

  const caseId = (data![0] as { id: string }).id;
  const seedProblem = await seedClearance(queryClient, caseId, input.employeeId);

  revalidatePath('/exits');
  revalidatePath('/employees');
  const problems = [mirrorProblem, seedProblem].filter(Boolean);
  return problems.length > 0
    ? { ok: true, warning: `The exit was started, but ${problems.join('; ')}.` }
    : { ok: true };
}

/**
 * Seed clearance rows from the asset and item registers.
 *
 * Re-runnable: the partial unique index on (exit_case_id, area, reference_id)
 * means a second call after a return does not duplicate rows.
 */
async function seedClearance(
  queryClient: Awaited<ReturnType<typeof createClient>>,
  exitCaseId: string,
  employeeId: string,
): Promise<string | null> {
  const rows: Array<Record<string, unknown>> = [];

  // Propagate read failures so missing checklist data cannot be mistaken for completed clearance.
  const { data: assets, error: assetErr } = await queryClient
    .from('assets')
    .select('id, desktop_name')
    .eq('assigned_employee_id', employeeId);
  if (assetErr) {
    return `the asset register could not be read for clearance: ${assetErr.message}`;
  }
  for (const a of (assets ?? []) as any[]) {
    rows.push({
      exit_case_id: exitCaseId,
      area: 'asset',
      reference_id: a.id,
      description: `Return asset: ${a.desktop_name}`,
    });
  }

  const { data: items, error: itemErr } = await queryClient
    .from('item_assignments')
    .select('id, quantity, items(item_name)')
    .eq('employee_id', employeeId)
    .eq('returned', false);
  if (itemErr) {
    return `the item register could not be read for clearance: ${itemErr.message}`;
  }
  for (const i of (items ?? []) as any[]) {
    rows.push({
      exit_case_id: exitCaseId,
      area: 'item',
      reference_id: i.id,
      description: `Return ${i.quantity} × ${i.items?.item_name ?? 'material/tool'}`,
    });
  }

  if (rows.length === 0) {
    return null;
  }
  // Ignore duplicate-key noise: re-seeding is the expected workflow.
  const { error: seedErr } = await queryClient.from('exit_clearance_items').upsert(rows, {
    onConflict: 'exit_case_id,area,reference_id',
    ignoreDuplicates: true,
  });
  if (seedErr) {
    return `the clearance checklist could not be written: ${seedErr.message}`;
  }
  return null;
}

/** Client-callable clearance-checklist fetch (queries/exits.ts is server-only). */
async function fetchClearanceItems(exitCaseId: string) {
  return readClearanceItems(exitCaseId);
}

// exit interview

/** The standard exit-interview questionnaire, seeded on first open. */
const interviewQuestions: readonly string[] = [
  'What prompted your decision to leave?',
  'Anything else you would like to tell us?',
  'What did you most enjoy about your role?',
  'What did you most enjoy about the company or team?',
  'What did you like most about the work environment?',
  'What would you change about the role or the team?',
  'Did you feel supported by your reporting manager?',
  'How would you rate the tools and equipment provided?',
  'Would you consider returning in future? Why or why not?',
  'What did you find most challenging about your role or the team?',
];

/**
 * Open the interview for a case: write the question set if it is not there yet.
 *
 * Questions are stored per-instance as individual rows to preserve the exact questionnaire snapshot.
 */
async function ensureExitInterview(exitCaseId: string): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Opening the exit interview');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();
  const { count, error: countErr } = await queryClient
    .from('exit_interviews')
    .select('id', { count: 'exact', head: true })
    .eq('exit_case_id', exitCaseId);
  if (countErr) {
    return { ok: false, error: countErr.message };
  }
  if ((count ?? 0) > 0) {
    // already open
    return { ok: true };
  }

  const rows = interviewQuestions.map((question) => ({
    exit_case_id: exitCaseId,
    question,
    interviewer_id: gate.profileId,
  }));
  const { error } = await queryClient.from('exit_interviews').insert(rows);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/**
 * Record answers. Only the ANSWER is writable — the question text and the
 * exit_case_id are never taken from the client, so a respondent cannot rewrite
 * the question they were asked.
 */
async function saveExitInterview(
  answers: Array<{ id: string; answer: string }>,
): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Saving the exit interview');
  if (!gate.ok) {
    return gate;
  }

  const clean = (Array.isArray(answers) ? answers : []).filter((a) =>
    uuidRe.test(String(a?.id ?? '')),
  );
  if (clean.length === 0) {
    return { ok: false, error: 'Nothing to save.' };
  }

  const queryClient = await createClient();
  const now = new Date();
  // Per-row updates: an upsert would need the full row and could overwrite the
  // question text, which is exactly what must stay immutable here.
  for (const a of clean) {
    const answer = String(a.answer ?? '').trim();
    const { error } = await queryClient
      .from('exit_interviews')
      .update({
        answer: answer || null,
        submitted_at: answer ? now : null,
        interviewer_id: gate.profileId,
      })
      .eq('id', a.id);
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Fetch interview rows for the client with an explicit return contract. */
async function fetchExitInterview(exitCaseId: string): Promise<ExitInterviewRow[]> {
  return readExitInterview(exitCaseId);
}

// knowledge transfer

/** Add a handover item, optionally naming who is taking it over. */
async function addKtItem(input: {
  exitCaseId: string;
  task: string;
  handoverTo?: string | null;
  notes?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Adding a handover item');
  if (!gate.ok) {
    return gate;
  }

  const task = String(input.task ?? '').trim();
  if (!uuidRe.test(String(input.exitCaseId ?? ''))) {
    return { ok: false, error: 'Unknown exit case.' };
  }
  if (!task) {
    return { ok: false, error: 'Describe what needs handing over.' };
  }

  const handoverTo = input.handoverTo && uuidRe.test(input.handoverTo) ? input.handoverTo : null;

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('knowledge_transfer_items')
    .insert({
      exit_case_id: input.exitCaseId,
      task,
      handover_to: handoverTo,
      notes: String(input.notes ?? '').trim() || null,
    })
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The item was not added — your role may lack permission.' };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Updates handover item status ('pending' | 'in_progress' | 'done'). */
async function setKtStatus(id: string, status: string): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Updating a handover item');
  if (!gate.ok) {
    return gate;
  }
  if (!['pending', 'in_progress', 'done'].includes(status)) {
    return { ok: false, error: `Invalid status: ${status || '(missing)'}` };
  }

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('knowledge_transfer_items')
    .update({ status })
    .eq('id', id)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That handover item no longer exists.' };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Remove a handover item. */
async function deleteKtItem(id: string): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Deleting a handover item');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('knowledge_transfer_items')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That handover item no longer exists.' };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Client-callable handover-list fetch. */
async function fetchKtItems(exitCaseId: string) {
  return readKtItems(exitCaseId);
}

/** Re-scan the asset/item registers for this exit (HR hits this after returns). */
async function refreshExitClearance(exitCaseId: string): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Refreshing clearance');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();
  const { data: kase } = await queryClient
    .from('exit_cases')
    .select('id, employee_id')
    .eq('id', exitCaseId)
    .maybeSingle<{ id: string; employee_id: string }>();
  if (!kase) {
    return { ok: false, error: 'That exit case no longer exists.' };
  }

  const seedProblem = await seedClearance(queryClient, kase.id, kase.employee_id);
  if (seedProblem) {
    return { ok: false, error: `Clearance could not be refreshed — ${seedProblem}.` };
  }
  revalidatePath('/exits');
  return { ok: true };
}

/** Tick off one clearance line. */
async function setClearanceItemCleared(id: string, cleared: boolean): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Clearing an exit item');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('exit_clearance_items')
    .update({
      cleared,
      cleared_by: cleared ? gate.profileId : null,
      cleared_at: cleared ? new Date() : null,
    })
    .eq('id', id)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That clearance item no longer exists.' };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Move the case to the next stage. Clearance must actually be clear first. */
async function setExitStage(
  exitCaseId: string,
  stage: 'initiated' | 'clearance' | 'settlement' | 'completed',
): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Changing the exit stage');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();

  // Fail-closed verification: transition to settlement/completed requires clearance_complete to be
  // explicitly true.
  if (stage === 'settlement' || stage === 'completed') {
    const { data: pending, error: pendingErr } = await queryClient
      .from('v_exit_clearance_pending')
      .select('assets_outstanding, items_outstanding, clearance_items_open, clearance_complete')
      .eq('exit_case_id', exitCaseId)
      .maybeSingle<{
        assets_outstanding: number;
        items_outstanding: number;
        clearance_items_open: number;
        clearance_complete: boolean;
      }>();
    if (pendingErr) {
      return { ok: false, error: `Clearance could not be verified: ${pendingErr.message}` };
    }
    if (!pending) {
      return {
        ok: false,
        error:
          'Clearance could not be verified for this exit case (no clearance record was readable), so the stage was not changed.',
      };
    }
    if (!pending.clearance_complete) {
      return {
        ok: false,
        error:
          `Clearance is not complete — ${pending.assets_outstanding} asset(s), ` +
          `${pending.items_outstanding} issued item(s) and ${pending.clearance_items_open} checklist item(s) ` +
          `are still outstanding.`,
      };
    }
  }

  if (stage === 'completed') {
    const { data: fnf } = await queryClient
      .from('full_and_final')
      .select('status')
      .eq('exit_case_id', exitCaseId)
      .maybeSingle<{ status: string }>();
    if (!fnf || fnf.status !== 'paid') {
      return {
        ok: false,
        error: 'The full & final settlement must be paid before the exit can be completed.',
      };
    }
  }

  const { data, error } = await queryClient
    .from('exit_cases')
    .update({ stage, completed_at: stage === 'completed' ? new Date() : null })
    .eq('id', exitCaseId)
    .select('id, employee_id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That exit case no longer exists.' };
  }

  // Deactivate login upon exit completion unless explicitly disabled by settings.
  let warning: string | undefined;
  if (stage === 'completed') {
    const { data: autoSetting } = await queryClient
      .from('settings')
      .select('value')
      .eq('key', 'exit_auto_deactivate')
      .maybeSingle<{ value: unknown }>();
    const autoDeactivate = !(autoSetting?.value === false || autoSetting?.value === 'false');

    if (autoDeactivate) {
      const { employee_id } = data![0] as { employee_id: string };
      const { data: emp } = await queryClient
        .from('employees')
        .select('code')
        .eq('id', employee_id)
        .maybeSingle<{ code: string }>();
      if (emp?.code) {
        const res = await deactivateEmployee(emp.code);
        if (!res.ok) {
          // The exit IS completed (the stage row is written) — a failed ban is
          // a warning to act on, not a failure to render.
          warning = `Exit completed, but the login could not be disabled: ${res.error}`;
        }
      }
    }
  }

  revalidatePath('/exits');
  revalidatePath('/employees');
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Build (or rebuild) the full & final sheet from live data.
 *
 * Populates initial settlement figures from outstanding reimbursements, approved leave encashment,
 * and unreturned asset values. Stored values may be manually adjusted prior to finalizing settlement.
 */
async function prepareFullAndFinal(exitCaseId: string): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Preparing the settlement');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();
  const { data: kase } = await queryClient
    .from('exit_cases')
    .select('id, employee_id')
    .eq('id', exitCaseId)
    .maybeSingle<{ id: string; employee_id: string }>();
  if (!kase) {
    return { ok: false, error: 'That exit case no longer exists.' };
  }

  // Approved but not yet paid reimbursements follow the employee out.
  const { data: claims } = await queryClient
    .from('reimbursement_claims')
    .select('amount, status')
    .eq('employee_id', kase.employee_id)
    .in('status', ['approved', 'finance_review']);
  const pendingReimbursements = (claims ?? []).reduce(
    (sum: number, c: any) => sum + (Number(c.amount) || 0),
    0,
  );

  const { data: enc } = await queryClient
    .from('leave_encashment')
    .select('amount, status')
    .eq('employee_id', kase.employee_id)
    .in('status', ['approved', 'paid']);
  const leaveEncashment = (enc ?? []).reduce(
    (sum: number, e: any) => sum + (Number(e.amount) || 0),
    0,
  );

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const netPayable = round2(pendingReimbursements + leaveEncashment);

  const { error } = await queryClient.from('full_and_final').upsert(
    {
      exit_case_id: exitCaseId,
      // Every figure here is a `decimal` column, so each goes in as
      // Decimal128 — an int32 0 fails the validator just as a double does.
      salary_payable: toMoney(0),
      leave_encashment: toMoney(round2(leaveEncashment)),
      pending_reimbursements: toMoney(round2(pendingReimbursements)),
      asset_recovery: toMoney(0),
      other_deductions: toMoney(0),
      net_payable: toMoney(netPayable),
      status: 'draft',
      prepared_by: gate.profileId,
      updated_at: new Date(),
    },
    { onConflict: 'exit_case_id' },
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Override the derived settlement figures, recomputing the net. */
async function updateFullAndFinal(
  exitCaseId: string,
  fields: {
    salaryPayable: number;
    leaveEncashment: number;
    pendingReimbursements: number;
    assetRecovery: number;
    otherDeductions: number;
  },
): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Updating the settlement');
  if (!gate.ok) {
    return gate;
  }

  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : 0;
  };
  const salary = n(fields.salaryPayable);
  const leave = n(fields.leaveEncashment);
  const reimb = n(fields.pendingReimbursements);
  const recovery = n(fields.assetRecovery);
  const deductions = n(fields.otherDeductions);
  const net = Math.round((salary + leave + reimb - recovery - deductions) * 100) / 100;

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('full_and_final')
    .update({
      salary_payable: toMoney(salary),
      leave_encashment: toMoney(leave),
      pending_reimbursements: toMoney(reimb),
      asset_recovery: toMoney(recovery),
      other_deductions: toMoney(deductions),
      net_payable: toMoney(net),
      updated_at: new Date(),
    })
    .eq('exit_case_id', exitCaseId)
    .eq('status', 'draft')
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only a draft settlement can be edited — prepare one first.' };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Approve, then pay, the settlement. */
async function setFullAndFinalStatus(
  exitCaseId: string,
  status: 'approved' | 'paid',
): Promise<ActionResult> {
  const gate = await requireRoles(exitRoles, 'Updating the settlement');
  if (!gate.ok) {
    return gate;
  }

  const from = status === 'approved' ? 'draft' : 'approved';
  const queryClient = await createClient();
  const patch: Record<string, unknown> = { status, updated_at: new Date() };
  if (status === 'approved') {
    patch.approved_by = gate.profileId;
    patch.approved_at = new Date();
  }

  const { data, error } = await queryClient
    .from('full_and_final')
    .update(patch)
    .eq('exit_case_id', exitCaseId)
    .eq('status', from)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: `Only a ${from} settlement can be marked ${status}.` };
  }

  revalidatePath('/exits');
  return { ok: true };
}

export {
  initiateExit,
  fetchClearanceItems,
  ensureExitInterview,
  saveExitInterview,
  fetchExitInterview,
  addKtItem,
  setKtStatus,
  deleteKtItem,
  fetchKtItems,
  refreshExitClearance,
  setClearanceItemCleared,
  setExitStage,
  prepareFullAndFinal,
  updateFullAndFinal,
  setFullAndFinalStatus,
};

export type { ExitInterviewRow, ActionResult };
