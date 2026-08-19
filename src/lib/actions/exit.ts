'use server';

// ============================================================================
// Employee exit workflow (migration 0037).
//
// Before this, "offboarding" was one button that flipped employees.status to
// inactive and banned the login. Everything a real exit needs — getting the
// laptop back, settling the last reimbursements, the relieving letter — happened
// in someone's head.
//
// The stage machine is initiated → clearance → settlement → completed, and the
// ORDER matters for one specific reason: the login ban comes LAST. Banning early
// locks the leaver out of the self-service pages they still need (exit
// interview, knowledge transfer, their own payslips), which is exactly the
// mistake the old single button made.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireRoles, wroteNothing } from '@/lib/actions/_guard';
import {
  getClearanceItems as readClearanceItems,
  getExitInterview as readExitInterview,
  getKtItems as readKtItems,
  type ExitInterviewRow,
} from '@/lib/queries';
import { notifyEmployee } from '@/lib/notify';
import { deactivateEmployee } from '@/lib/actions/employees';
import { uploadFileService } from '@/lib/storage';
import { todayIST } from '@/lib/format';
import { renderLetterPdf } from '@/lib/documents/letters';
import {
  buildRelievingLetter,
  buildExperienceLetter,
  buildFullAndFinalStatement,
} from '@/lib/documents/templates';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** The action SUCCEEDED but a follow-up needs attention. ok stays true. */
  warning?: string;
}

const EXIT_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// IST, not the host clock: a letter issued between 00:00 and 05:30 IST used
// to be dated the previous day (new Date().toISOString() is UTC).
function today(): string {
  return todayIST();
}

/**
 * Open an exit case and put the employee on notice.
 *
 * `employees.status = 'on_notice'` finally uses the enum value that has existed
 * since 0001 and was never written: the roster can now distinguish "leaving" from
 * "gone", and the leave provisioner (0036) deliberately still credits them.
 */
export async function initiateExit(input: {
  employeeId: string;
  resignationDate: string;
  lastWorkingDay: string;
  reason?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Starting an exit');
  if (!gate.ok) return gate;

  if (!UUID_RE.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  if (!ISO_DATE.test(input.resignationDate)) return { ok: false, error: 'Enter the resignation date.' };
  if (!ISO_DATE.test(input.lastWorkingDay)) return { ok: false, error: 'Enter the last working day.' };
  if (input.lastWorkingDay < input.resignationDate) {
    return { ok: false, error: 'The last working day cannot be before the resignation date.' };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
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
    // The partial unique index (0037) allows only one non-completed case.
    if (error.code === '23505') {
      return { ok: false, error: 'This employee already has an exit in progress.' };
    }
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'The exit workflow is not set up on the database yet — apply migration 0037.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) return { ok: false, error: 'The exit was not started — your role may lack permission.' };

  // Mirror the dates onto the employee and mark them on notice. The login stays
  // ACTIVE — see the file header. A failure here is a WARNING, not a rollback:
  // the case exists, but the roster would silently keep showing "active", so it
  // must never be swallowed.
  const noticeDays = Math.round(
    (Date.parse(`${input.lastWorkingDay}T00:00:00Z`) - Date.parse(`${input.resignationDate}T00:00:00Z`)) / 86_400_000,
  );
  const { data: mirrored, error: mirrorErr } = await supabase
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
  const seedProblem = await seedClearance(supabase, caseId, input.employeeId);

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
  supabase: Awaited<ReturnType<typeof createClient>>,
  exitCaseId: string,
  employeeId: string,
): Promise<string | null> {
  const rows: Record<string, unknown>[] = [];

  // A failed read must NOT seed an empty checklist — an empty checklist reads
  // as "clearance complete" and lets the exit advance with assets outstanding.
  const { data: assets, error: assetErr } = await supabase
    .from('assets')
    .select('id, desktop_name')
    .eq('assigned_employee_id', employeeId);
  if (assetErr) return `the asset register could not be read for clearance: ${assetErr.message}`;
  for (const a of (assets ?? []) as any[]) {
    rows.push({
      exit_case_id: exitCaseId,
      area: 'asset',
      reference_id: a.id,
      description: `Return asset: ${a.desktop_name}`,
    });
  }

  const { data: items, error: itemErr } = await supabase
    .from('item_assignments')
    .select('id, quantity, items(item_name)')
    .eq('employee_id', employeeId)
    .eq('returned', false);
  if (itemErr) return `the item register could not be read for clearance: ${itemErr.message}`;
  for (const i of (items ?? []) as any[]) {
    rows.push({
      exit_case_id: exitCaseId,
      area: 'item',
      reference_id: i.id,
      description: `Return ${i.quantity} × ${i.items?.item_name ?? 'material/tool'}`,
    });
  }

  if (rows.length === 0) return null;
  // Ignore duplicate-key noise: re-seeding is the expected workflow.
  const { error: seedErr } = await supabase.from('exit_clearance_items').upsert(rows, {
    onConflict: 'exit_case_id,area,reference_id',
    ignoreDuplicates: true,
  });
  if (seedErr) return `the clearance checklist could not be written: ${seedErr.message}`;
  return null;
}

/** Client-callable clearance-checklist fetch (queries.ts is server-only). */
export async function fetchClearanceItems(exitCaseId: string) {
  return readClearanceItems(exitCaseId);
}

// ------------------------------------------------------- exit interview ---

/** The standard exit-interview questionnaire, seeded on first open. */
const INTERVIEW_QUESTIONS: readonly string[] = [
  'What prompted your decision to leave?',
  'What did you most enjoy about working here?',
  'What would you change about the role or the team?',
  'Did you feel supported by your reporting manager?',
  'How would you rate the tools and equipment provided?',
  'Would you consider returning in future? Why or why not?',
  'Anything else you would like to tell us?',
];

/**
 * Open the interview for a case: write the question set if it is not there yet.
 *
 * Questions are stored as ROWS rather than rendered from a constant so a later
 * edit to the questionnaire cannot retroactively change what a past leaver was
 * actually asked — the 0037 table comment makes the same point.
 */
export async function ensureExitInterview(exitCaseId: string): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Opening the exit interview');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { count, error: countErr } = await supabase
    .from('exit_interviews')
    .select('id', { count: 'exact', head: true })
    .eq('exit_case_id', exitCaseId);
  if (countErr) {
    if (countErr.code === '42P01' || countErr.code === 'PGRST205') {
      return { ok: false, error: 'The exit workflow is not set up on the database yet — apply migration 0037.' };
    }
    return { ok: false, error: countErr.message };
  }
  if ((count ?? 0) > 0) return { ok: true }; // already open

  const rows = INTERVIEW_QUESTIONS.map((question) => ({
    exit_case_id: exitCaseId,
    question,
    interviewer_id: gate.profileId,
  }));
  const { error } = await supabase.from('exit_interviews').insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/exits');
  return { ok: true };
}

/**
 * Record answers. Only the ANSWER is writable — the question text and the
 * exit_case_id are never taken from the client, so a respondent cannot rewrite
 * the question they were asked.
 */
export async function saveExitInterview(
  answers: { id: string; answer: string }[],
): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Saving the exit interview');
  if (!gate.ok) return gate;

  const clean = (Array.isArray(answers) ? answers : []).filter((a) => UUID_RE.test(String(a?.id ?? '')));
  if (clean.length === 0) return { ok: false, error: 'Nothing to save.' };

  const supabase = await createClient();
  const now = new Date().toISOString();
  // Per-row updates: an upsert would need the full row and could overwrite the
  // question text, which is exactly what must stay immutable here.
  for (const a of clean) {
    const answer = String(a.answer ?? '').trim();
    const { error } = await supabase
      .from('exit_interviews')
      .update({
        answer: answer || null,
        submitted_at: answer ? now : null,
        interviewer_id: gate.profileId,
      })
      .eq('id', a.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/**
 * Client-callable interview fetch.
 *
 * The return type is explicit on purpose: without it, a resolution failure in
 * the underlying query degrades this to `any` and the error surfaces far away,
 * as an implicit-any on the caller's `.map()` callback rather than here.
 */
export async function fetchExitInterview(exitCaseId: string): Promise<ExitInterviewRow[]> {
  return readExitInterview(exitCaseId);
}

// ---------------------------------------------------- knowledge transfer ---

/** Add a handover item, optionally naming who is taking it over. */
export async function addKtItem(input: {
  exitCaseId: string;
  task: string;
  handoverTo?: string | null;
  notes?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Adding a handover item');
  if (!gate.ok) return gate;

  const task = String(input.task ?? '').trim();
  if (!UUID_RE.test(String(input.exitCaseId ?? ''))) return { ok: false, error: 'Unknown exit case.' };
  if (!task) return { ok: false, error: 'Describe what needs handing over.' };

  const handoverTo = input.handoverTo && UUID_RE.test(input.handoverTo) ? input.handoverTo : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('knowledge_transfer_items')
    .insert({
      exit_case_id: input.exitCaseId,
      task,
      handover_to: handoverTo,
      notes: String(input.notes ?? '').trim() || null,
    })
    .select('id');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'The exit workflow is not set up on the database yet — apply migration 0037.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) return { ok: false, error: 'The item was not added — your role may lack permission.' };

  revalidatePath('/exits');
  return { ok: true };
}

/** Advance a handover item. Status set matches the 0037 CHECK constraint. */
export async function setKtStatus(id: string, status: string): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Updating a handover item');
  if (!gate.ok) return gate;
  if (!['pending', 'in_progress', 'done'].includes(status)) {
    return { ok: false, error: `Invalid status: ${status || '(missing)'}` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('knowledge_transfer_items')
    .update({ status })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That handover item no longer exists.' };

  revalidatePath('/exits');
  return { ok: true };
}

/** Remove a handover item. */
export async function deleteKtItem(id: string): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Deleting a handover item');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('knowledge_transfer_items')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That handover item no longer exists.' };

  revalidatePath('/exits');
  return { ok: true };
}

/** Client-callable handover-list fetch. */
export async function fetchKtItems(exitCaseId: string) {
  return readKtItems(exitCaseId);
}

/** Re-scan the asset/item registers for this exit (HR hits this after returns). */
export async function refreshExitClearance(exitCaseId: string): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Refreshing clearance');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data: kase } = await supabase
    .from('exit_cases')
    .select('id, employee_id')
    .eq('id', exitCaseId)
    .maybeSingle<{ id: string; employee_id: string }>();
  if (!kase) return { ok: false, error: 'That exit case no longer exists.' };

  const seedProblem = await seedClearance(supabase, kase.id, kase.employee_id);
  if (seedProblem) return { ok: false, error: `Clearance could not be refreshed — ${seedProblem}.` };
  revalidatePath('/exits');
  return { ok: true };
}

/** Tick off one clearance line. */
export async function setClearanceItemCleared(id: string, cleared: boolean): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Clearing an exit item');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exit_clearance_items')
    .update({
      cleared,
      cleared_by: cleared ? gate.profileId : null,
      cleared_at: cleared ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That clearance item no longer exists.' };

  revalidatePath('/exits');
  return { ok: true };
}

/** Move the case to the next stage. Clearance must actually be clear first. */
export async function setExitStage(
  exitCaseId: string,
  stage: 'initiated' | 'clearance' | 'settlement' | 'completed',
): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Changing the exit stage');
  if (!gate.ok) return gate;

  const supabase = await createClient();

  // Guard the two transitions that must not be taken on trust. FAIL CLOSED:
  // the view (0037 §7) emits a row for EVERY exit case, so a missing row means
  // the case is gone, RLS filtered it, or the read failed — never "all clear".
  // The old check only blocked when a row said not-complete, which let an exit
  // advance past an unreturned laptop whenever the read came back empty.
  if (stage === 'settlement' || stage === 'completed') {
    const { data: pending, error: pendingErr } = await supabase
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
    const { data: fnf } = await supabase
      .from('full_and_final')
      .select('status')
      .eq('exit_case_id', exitCaseId)
      .maybeSingle<{ status: string }>();
    if (!fnf || fnf.status !== 'paid') {
      return { ok: false, error: 'The full & final settlement must be paid before the exit can be completed.' };
    }
  }

  const { data, error } = await supabase
    .from('exit_cases')
    .update({ stage, completed_at: stage === 'completed' ? new Date().toISOString() : null })
    .eq('id', exitCaseId)
    .select('id, employee_id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That exit case no longer exists.' };

  // THE LAST STEP: only once everything is settled does the login go away.
  // The exit_auto_deactivate setting (0037) can switch this off for companies
  // that keep alumni logins alive; anything but an explicit false deactivates.
  let warning: string | undefined;
  if (stage === 'completed') {
    const { data: autoSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'exit_auto_deactivate')
      .maybeSingle<{ value: unknown }>();
    const autoDeactivate = !(autoSetting?.value === false || autoSetting?.value === 'false');

    if (autoDeactivate) {
      const { employee_id } = data![0] as { employee_id: string };
      const { data: emp } = await supabase
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
 * Every component is DERIVED here rather than typed: approved-but-unpaid
 * reimbursements, approved leave encashment, and a count-based asset recovery
 * placeholder. HR can override the stored numbers afterwards — 0037's column
 * comment is explicit that the sheet must show what was actually paid.
 */
export async function prepareFullAndFinal(exitCaseId: string): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Preparing the settlement');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data: kase } = await supabase
    .from('exit_cases')
    .select('id, employee_id')
    .eq('id', exitCaseId)
    .maybeSingle<{ id: string; employee_id: string }>();
  if (!kase) return { ok: false, error: 'That exit case no longer exists.' };

  // Approved but not yet paid reimbursements follow the employee out.
  const { data: claims } = await supabase
    .from('reimbursement_claims')
    .select('amount, status')
    .eq('employee_id', kase.employee_id)
    .in('status', ['approved', 'finance_review']);
  const pendingReimbursements = (claims ?? []).reduce(
    (sum: number, c: any) => sum + (Number(c.amount) || 0),
    0,
  );

  const { data: enc } = await supabase
    .from('leave_encashment')
    .select('amount, status')
    .eq('employee_id', kase.employee_id)
    .in('status', ['approved', 'paid']);
  const leaveEncashment = (enc ?? []).reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const netPayable = round2(pendingReimbursements + leaveEncashment);

  const { error } = await supabase.from('full_and_final').upsert(
    {
      exit_case_id: exitCaseId,
      salary_payable: 0,
      leave_encashment: round2(leaveEncashment),
      pending_reimbursements: round2(pendingReimbursements),
      asset_recovery: 0,
      other_deductions: 0,
      net_payable: netPayable,
      status: 'draft',
      prepared_by: gate.profileId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'exit_case_id' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/exits');
  return { ok: true };
}

/** Override the derived settlement figures, recomputing the net. */
export async function updateFullAndFinal(
  exitCaseId: string,
  fields: {
    salaryPayable: number;
    leaveEncashment: number;
    pendingReimbursements: number;
    assetRecovery: number;
    otherDeductions: number;
  },
): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Updating the settlement');
  if (!gate.ok) return gate;

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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('full_and_final')
    .update({
      salary_payable: salary,
      leave_encashment: leave,
      pending_reimbursements: reimb,
      asset_recovery: recovery,
      other_deductions: deductions,
      net_payable: net,
      updated_at: new Date().toISOString(),
    })
    .eq('exit_case_id', exitCaseId)
    .eq('status', 'draft')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only a draft settlement can be edited — prepare one first.' };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/** Approve, then pay, the settlement. */
export async function setFullAndFinalStatus(
  exitCaseId: string,
  status: 'approved' | 'paid',
): Promise<ActionResult> {
  const gate = await requireRoles(EXIT_ROLES, 'Updating the settlement');
  if (!gate.ok) return gate;

  const from = status === 'approved' ? 'draft' : 'approved';
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'approved') {
    patch.approved_by = gate.profileId;
    patch.approved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('full_and_final')
    .update(patch)
    .eq('exit_case_id', exitCaseId)
    .eq('status', from)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: `Only a ${from} settlement can be marked ${status}.` };
  }

  revalidatePath('/exits');
  return { ok: true };
}

/**
 * Generate a relieving / experience / F&F PDF into the generated-documents
 * bucket and return a note of where it landed.
 *
 * Uses the SERVICE-role upload: the document is produced by HR about someone
 * else, so it is written into that employee's folder on their behalf.
 */
export async function generateExitDocument(
  exitCaseId: string,
  kind: 'relieving' | 'experience' | 'fnf',
): Promise<ActionResult & { path?: string }> {
  const gate = await requireRoles(EXIT_ROLES, 'Generating an exit document');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data: kase } = await supabase
    .from('exit_cases')
    .select('id, employee_id, last_working_day, employees(code, full_name, date_of_joining, designation)')
    .eq('id', exitCaseId)
    .maybeSingle<any>();
  if (!kase) return { ok: false, error: 'That exit case no longer exists.' };

  const emp = kase.employees ?? {};
  const issuedOn = today();
  const base = {
    employeeName: emp.full_name ?? '',
    employeeCode: emp.code ?? '',
    designation: emp.designation ?? undefined,
    dateOfJoining: String(emp.date_of_joining ?? '').slice(0, 10),
    lastWorkingDay: String(kase.last_working_day ?? '').slice(0, 10),
    issuedOn,
  };
  if (!base.employeeName || !base.dateOfJoining || !base.lastWorkingDay) {
    return { ok: false, error: 'The employee record is missing a joining date or last working day.' };
  }

  let spec;
  let filename: string;
  if (kind === 'relieving') {
    spec = buildRelievingLetter(base);
    filename = `relieving-${base.employeeCode}.pdf`;
  } else if (kind === 'experience') {
    spec = buildExperienceLetter(base);
    filename = `experience-${base.employeeCode}.pdf`;
  } else {
    const { data: fnf } = await supabase
      .from('full_and_final')
      .select('salary_payable, leave_encashment, pending_reimbursements, asset_recovery, other_deductions, net_payable')
      .eq('exit_case_id', exitCaseId)
      .maybeSingle<any>();
    if (!fnf) return { ok: false, error: 'Prepare the settlement before generating its statement.' };
    spec = buildFullAndFinalStatement({
      employeeName: base.employeeName,
      employeeCode: base.employeeCode,
      lastWorkingDay: base.lastWorkingDay,
      issuedOn,
      salaryPayable: Number(fnf.salary_payable ?? 0),
      leaveEncashment: Number(fnf.leave_encashment ?? 0),
      pendingReimbursements: Number(fnf.pending_reimbursements ?? 0),
      assetRecovery: Number(fnf.asset_recovery ?? 0),
      otherDeductions: Number(fnf.other_deductions ?? 0),
      netPayable: Number(fnf.net_payable ?? 0),
    });
    filename = `full-and-final-${base.employeeCode}.pdf`;
  }

  let bytes: Uint8Array;
  try {
    bytes = await renderLetterPdf(spec);
  } catch (e) {
    return { ok: false, error: `The document could not be rendered: ${e instanceof Error ? e.message : String(e)}` };
  }

  const up = await uploadFileService('generated-documents', kase.employee_id, filename, bytes, 'application/pdf');
  if (!up.ok) return { ok: false, error: up.error ?? 'The document could not be stored.' };

  // The PDF went to generated-documents, NOT the employee-documents bucket the
  // register historically assumed. Recording the bucket is what lets
  // getDocumentUrl sign it against the right one (0039).
  const { data: docRow, error: docErr } = await supabase
    .from('employee_documents')
    .insert({
      employee_id: kase.employee_id,
      bucket: 'generated-documents',
      category: kind === 'fnf' ? 'settlement' : kind,
      title: filename,
      storage_path: up.path,
      uploaded_by: gate.profileId,
      // An HR-issued letter is authoritative the moment it is produced. Stamping
      // it here keeps it out of getUnverifiedDocuments, which is HR's "an
      // employee filed something, please check it" queue — not a self-review one.
      verified_by: gate.profileId,
      verified_at: new Date().toISOString(),
    })
    .select('id');
  if (docErr) {
    return {
      ok: false,
      error: `The PDF was stored but could not be filed against the employee: ${docErr.message}`,
    };
  }
  if (wroteNothing(docRow)) {
    return { ok: false, error: 'The document was not filed against the employee.' };
  }

  await notifyEmployee(kase.employee_id, {
    kind: 'system',
    title: 'A document was issued to you',
    body: filename,
    link: '/me#documents',
  });

  revalidatePath('/exits');
  return { ok: true, path: up.path };
}
