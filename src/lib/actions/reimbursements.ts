'use server';

// ============================================================================
// Reimbursement claims: employee submits, staff approves.
//
// Travel claims derive their amount from kms × the settings-driven ₹/km rate.
// That multiplication is redone on the SERVER — the browser's live preview is a
// convenience, never the authority, so a tampered amount can't be approved.
//
// On approval the amount is added to the employee's payslip
// reimbursement_bonus adjustment for the claim's month and the payslip is
// recomputed, so an approved claim is paid with salary.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { getReimbursementRate } from '@/lib/queries';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';
import type { ReimbursementPurpose } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const PURPOSES: readonly ReimbursementPurpose[] = ['travel', 'material_purchase', 'other'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse '1,234.50' / '₹1,234.50' -> 1234.5; null when unparseable. */
function money(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? '').trim().replace(/[,\s₹]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export async function createReimbursement(formData: FormData): Promise<ActionResult> {
  // --- validate before touching auth or the network --------------------------
  const description = String(formData.get('description') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim() as ReimbursementPurpose;
  const claimDate = String(formData.get('claim_date') ?? '').trim();
  const sourceMedium = String(formData.get('source_medium') ?? '').trim() || null;
  const modeOfPayment = String(formData.get('mode_of_payment') ?? '').trim() || null;
  const remarks = String(formData.get('remarks') ?? '').trim() || null;

  if (!description) return { ok: false, error: 'Enter a description.' };
  if (!PURPOSES.includes(purpose)) return { ok: false, error: 'Choose a purpose.' };
  if (!ISO_DATE.test(claimDate)) return { ok: false, error: 'Choose a valid date.' };

  const kmsRaw = money(formData.get('kms'));
  let amount: number;
  let kms: number | null = null;

  if (purpose === 'travel') {
    if (kmsRaw === null || kmsRaw <= 0) {
      return { ok: false, error: 'Enter the distance in km for a travel claim.' };
    }
    kms = kmsRaw;
    // Server-side authority: amount is always kms × rate for travel.
    const rate = await getReimbursementRate();
    amount = Math.round(kms * rate * 100) / 100;
  } else {
    const typed = money(formData.get('amount'));
    if (typed === null || typed <= 0) return { ok: false, error: 'Enter the claim amount.' };
    amount = typed;
  }

  const db = requireDb('Filing a reimbursement claim');
  if (!db.ok) return db;

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return {
      ok: false,
      error: 'Your login is not linked to an employee record, so a claim cannot be filed. Ask HR to link it.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .insert({
      employee_id: employeeId,
      claim_date: claimDate,
      description,
      purpose,
      source_medium: sourceMedium,
      kms,
      mode_of_payment: modeOfPayment,
      amount,
      remarks,
      status: 'pending',
    })
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The claim was not filed — your account may not have permission.' };
  }

  await notifyApprovers(
    {
      kind: 'reimbursement',
      title: `${profile?.full_name ?? 'An employee'} filed a reimbursement claim`,
      body: `${description} · ₹${amount.toFixed(2)}`,
      link: '/reimbursements',
    },
    profile?.id,
  );

  revalidatePath('/me');
  revalidatePath('/reimbursements');
  return { ok: true };
}

/**
 * Push an approved claim into the payslip's reimbursement_bonus for the claim's
 * month, then recompute that payslip. Returns a warning when it could not be
 * applied (no run yet, run locked, …) — the approval itself still stands.
 */
async function addToPayroll(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  claimDate: string,
  amount: number,
): Promise<string | null> {
  const periodStart = `${claimDate.slice(0, 7)}-01`;

  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('period_month', periodStart)
    .maybeSingle<{ id: string; status: string }>();
  if (runErr) return `Approved, but the payroll run could not be read: ${runErr.message}`;
  if (!run) {
    return `Approved. No payroll run exists for ${periodStart.slice(0, 7)} yet, so it will need adding to that run's adjustments once it is started.`;
  }
  if (run.status === 'locked' || run.status === 'paid') {
    return `Approved, but the ${periodStart.slice(0, 7)} payroll run is ${run.status}, so it could not be added to that payslip. Pay it separately.`;
  }

  const { data: payslip, error: psErr } = await supabase
    .from('payslips')
    .select('id')
    .eq('payroll_run_id', run.id)
    .eq('employee_id', employeeId)
    .maybeSingle<{ id: string }>();
  if (psErr) return `Approved, but the payslip could not be read: ${psErr.message}`;
  if (!payslip) {
    return 'Approved. This employee has no payslip in that run yet — recompute drafts, then it can be added.';
  }

  // Read-modify-write the existing bonus so multiple approved claims accumulate.
  const { data: existing, error: adjErr } = await supabase
    .from('payslip_adjustments')
    .select('reimbursement_bonus')
    .eq('id', payslip.id)
    .maybeSingle<{ reimbursement_bonus: number | string | null }>();
  if (adjErr) return `Approved, but the current adjustments could not be read: ${adjErr.message}`;

  const current = Number(existing?.reimbursement_bonus ?? 0) || 0;
  const next = Math.round((current + amount) * 100) / 100;

  const { error: upErr } = await supabase
    .from('payslip_adjustments')
    .upsert({ id: payslip.id, reimbursement_bonus: next, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (upErr) return `Approved, but the payslip adjustment failed: ${upErr.message}`;

  const { error: recomputeErr } = await supabase.rpc('fn_compute_payslip', {
    p_employee_id: employeeId,
    p_run_id: run.id,
  });
  if (recomputeErr) {
    return `Approved and added, but recomputing the payslip failed, so the net pay shown is stale: ${recomputeErr.message}`;
  }

  revalidatePath('/payroll');
  return null;
}

export async function reviewReimbursement(
  id: string,
  decision: 'approved' | 'rejected',
  remark?: string,
): Promise<ActionResult> {
  const gate = await requireStaff(`Marking a claim ${decision}`);
  if (!gate.ok) return gate;

  // A rejection must say why — the employee sees this note on their dashboard.
  const cleanRemark = (remark ?? '').trim();
  if (decision === 'rejected' && !cleanRemark) {
    return { ok: false, error: 'Enter a reason for rejecting this claim.' };
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    status: decision,
    reviewed_by: gate.profileId,
    reviewed_at: new Date().toISOString(),
  };
  if (decision === 'rejected') patch.review_remark = cleanRemark;

  const { data, error } = await supabase
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, employee_id, claim_date, amount, purpose, kms');

  if (error) {
    if (error.code === '42703') {
      return {
        ok: false,
        error: 'Rejection remarks aren’t set up on the database yet — apply migration 0020.',
      };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error:
        'The claim was not updated — it may already have been reviewed, or your role lacks permission.',
    };
  }

  const row = data![0] as {
    employee_id: string;
    claim_date: string;
    amount: number | string;
    purpose: ReimbursementPurpose;
    kms: number | string | null;
  };

  // Re-derive a travel claim's amount at approval so an employee who edited the
  // pending claim's kms/amount (RLS can't restrict columns) can't inflate pay.
  let finalAmount = Number(row.amount);
  if (decision === 'approved' && row.purpose === 'travel' && row.kms != null) {
    const rate = await getReimbursementRate();
    const corrected = Math.round(Number(row.kms) * rate * 100) / 100;
    if (corrected !== finalAmount) {
      finalAmount = corrected;
      await supabase.from('reimbursement_claims').update({ amount: corrected }).eq('id', id);
    }
  }

  revalidatePath('/reimbursements');
  revalidatePath('/me');

  await notifyEmployee(row.employee_id, {
    kind: 'reimbursement',
    title: `Your reimbursement claim was ${decision}`,
    body:
      decision === 'approved'
        ? `₹${finalAmount.toFixed(2)} — it will be paid with your salary.`
        : `₹${finalAmount.toFixed(2)} — ${cleanRemark}`,
    link: '/me',
  });

  if (decision === 'approved') {
    const warning = await addToPayroll(
      supabase,
      row.employee_id,
      String(row.claim_date).slice(0, 10),
      finalAmount,
    );
    if (warning) return { ok: false, error: warning };
  }

  return { ok: true };
}

/**
 * Employee edits their OWN still-pending claim. RLS (0020) restricts the write
 * to own + pending rows; travel amount is recomputed server-side, exactly as at
 * creation, so it never trusts the browser.
 */
export async function updateReimbursement(id: string, formData: FormData): Promise<ActionResult> {
  const description = String(formData.get('description') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim() as ReimbursementPurpose;
  const claimDate = String(formData.get('claim_date') ?? '').trim();
  const sourceMedium = String(formData.get('source_medium') ?? '').trim() || null;
  const modeOfPayment = String(formData.get('mode_of_payment') ?? '').trim() || null;
  const remarks = String(formData.get('remarks') ?? '').trim() || null;

  if (!description) return { ok: false, error: 'Enter a description.' };
  if (!PURPOSES.includes(purpose)) return { ok: false, error: 'Choose a purpose.' };
  if (!ISO_DATE.test(claimDate)) return { ok: false, error: 'Choose a valid date.' };

  const kmsRaw = money(formData.get('kms'));
  let amount: number;
  let kms: number | null = null;
  if (purpose === 'travel') {
    if (kmsRaw === null || kmsRaw <= 0) {
      return { ok: false, error: 'Enter the distance in km for a travel claim.' };
    }
    kms = kmsRaw;
    const rate = await getReimbursementRate();
    amount = Math.round(kms * rate * 100) / 100;
  } else {
    const typed = money(formData.get('amount'));
    if (typed === null || typed <= 0) return { ok: false, error: 'Enter the claim amount.' };
    amount = typed;
  }

  const db = requireDb('Editing a reimbursement claim');
  if (!db.ok) return db;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .update({
      claim_date: claimDate,
      description,
      purpose,
      source_medium: sourceMedium,
      kms,
      mode_of_payment: modeOfPayment,
      amount,
      remarks,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The claim was not updated — it may already have been reviewed, or it is not yours.',
    };
  }

  revalidatePath('/me');
  revalidatePath('/reimbursements');
  return { ok: true };
}

/** Employee withdraws their OWN still-pending claim. RLS restricts it to that. */
export async function deleteReimbursement(id: string): Promise<ActionResult> {
  const db = requireDb('Withdrawing a reimbursement claim');
  if (!db.ok) return db;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The claim was not withdrawn — it may already have been reviewed, or it is not yours.',
    };
  }

  revalidatePath('/me');
  revalidatePath('/reimbursements');
  return { ok: true };
}

/** Mark an approved claim as paid (e.g. settled outside payroll). */
export async function markReimbursementPaid(id: string): Promise<ActionResult> {
  const gate = await requireStaff('Marking a claim paid');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .update({ status: 'paid' })
    .eq('id', id)
    .eq('status', 'approved')
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only an approved claim can be marked paid.' };
  }

  revalidatePath('/reimbursements');
  revalidatePath('/me');
  return { ok: true };
}
