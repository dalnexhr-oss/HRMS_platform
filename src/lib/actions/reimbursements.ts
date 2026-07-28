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
import { getReimbursementRate, getReimbursementEvents } from '@/lib/queries';
import { uploadFile, signedUrl } from '@/lib/storage';
import { requireDb, requireRoles, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';
import type { ReimbursementPurpose } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const PURPOSES: readonly ReimbursementPurpose[] = ['travel', 'material_purchase', 'other'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Append one row to the claim's timeline (migration 0035).
 *
 * BEST-EFFORT, exactly like notify.ts: the business write is already committed
 * and PostgREST gives us no transaction across the two, so a failed event must
 * never turn a successful approval into an error. It is logged instead.
 */
async function logClaimEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  claimId: string,
  input: {
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    remark?: string | null;
    metadata?: Record<string, unknown>;
    actorId?: string | null;
    actorName?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('reimbursement_events').insert({
    claim_id: claimId,
    actor_id: input.actorId ?? null,
    actor_name: input.actorName ?? null,
    action: input.action,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    remark: input.remark ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) {
    // 42P01/PGRST205 = migration 0035 not applied yet; that is not an error the
    // user needs to see, the claim action itself succeeded.
    if (error.code !== '42P01' && error.code !== 'PGRST205') {
      console.warn(`[dalnex-hrms] claim event (${input.action}) failed:`, error.message);
    }
  }
}

/** True when the optional Finance second-approval stage is switched on (0035). */
async function financeStageEnabled(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'reimbursement_finance_stage')
    .maybeSingle<{ value: unknown }>();
  return data?.value === true || data?.value === 'true';
}

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

  await logClaimEvent(supabase, (data![0] as { id: string }).id, {
    action: 'submitted',
    toStatus: 'pending',
    actorId: profile?.id ?? null,
    actorName: profile?.full_name ?? null,
    metadata: { amount, purpose },
  });

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

  // With the optional Finance stage on (0035), a staff approval does NOT credit
  // payroll — it hands the claim to Finance for the final say. Off, the flow is
  // unchanged: approve → payroll.
  const twoStage = decision === 'approved' && (await financeStageEnabled(supabase));
  const nextStatus = decision === 'approved' ? (twoStage ? 'finance_review' : 'approved') : 'rejected';

  const patch: Record<string, unknown> = {
    status: nextStatus,
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

  const { profile } = await getSession();
  await logClaimEvent(supabase, id, {
    action: decision === 'approved' ? (twoStage ? 'sent_to_finance' : 'approved') : 'rejected',
    fromStatus: 'pending',
    toStatus: nextStatus,
    remark: decision === 'rejected' ? cleanRemark : null,
    actorId: gate.profileId,
    actorName: profile?.full_name ?? null,
    metadata: { amount: finalAmount },
  });

  revalidatePath('/reimbursements');
  revalidatePath('/me');

  await notifyEmployee(row.employee_id, {
    kind: 'reimbursement',
    title:
      decision === 'approved'
        ? twoStage
          ? 'Your reimbursement claim is with Finance'
          : 'Your reimbursement claim was approved'
        : 'Your reimbursement claim was rejected',
    body:
      decision === 'approved'
        ? twoStage
          ? `₹${finalAmount.toFixed(2)} — approved by HR, awaiting the Finance check.`
          : `₹${finalAmount.toFixed(2)} — it will be paid with your salary.`
        : `₹${finalAmount.toFixed(2)} — ${cleanRemark}`,
    link: '/me',
  });

  // Payroll is credited only on FINAL approval. With the Finance stage on, that
  // is financeReviewReimbursement, not here.
  if (decision === 'approved' && !twoStage) {
    const warning = await addToPayroll(
      supabase,
      row.employee_id,
      String(row.claim_date).slice(0, 10),
      finalAmount,
    );
    if (warning) return { ok: false, error: warning };
  }

  if (twoStage) {
    await notifyApprovers(
      {
        kind: 'reimbursement',
        title: 'A claim is awaiting Finance approval',
        body: `₹${finalAmount.toFixed(2)} — approved by HR, needs the Finance check.`,
        link: '/reimbursements',
      },
      gate.profileId,
    );
  }

  return { ok: true };
}

/**
 * The Finance stage's final say on a claim already approved by HR
 * (status='finance_review'). Approving here is what credits payroll; rejecting
 * sends it back to the employee with a reason. Admin-only — Finance sign-off is
 * deliberately narrower than the general staff gate.
 */
export async function financeReviewReimbursement(
  id: string,
  decision: 'approved' | 'rejected',
  remark?: string,
): Promise<ActionResult> {
  const gate = await requireRoles(['admin'], `Finance-${decision === 'approved' ? 'approving' : 'rejecting'} a claim`);
  if (!gate.ok) return gate;

  const cleanRemark = (remark ?? '').trim();
  if (decision === 'rejected' && !cleanRemark) {
    return { ok: false, error: 'Enter a reason for rejecting this claim.' };
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    status: decision === 'approved' ? 'approved' : 'rejected',
    finance_reviewed_by: gate.profileId,
    finance_reviewed_at: new Date().toISOString(),
  };
  if (decision === 'rejected') patch.review_remark = cleanRemark;

  const { data, error } = await supabase
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .eq('status', 'finance_review')
    .select('id, employee_id, claim_date, amount');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only a claim awaiting Finance approval can be reviewed here.' };
  }

  const row = data![0] as { employee_id: string; claim_date: string; amount: number | string };
  const amount = Number(row.amount);
  const { profile } = await getSession();

  await logClaimEvent(supabase, id, {
    action: decision === 'approved' ? 'finance_approved' : 'finance_rejected',
    fromStatus: 'finance_review',
    toStatus: String(patch.status),
    remark: decision === 'rejected' ? cleanRemark : null,
    actorId: gate.profileId,
    actorName: profile?.full_name ?? null,
    metadata: { amount },
  });

  revalidatePath('/reimbursements');
  revalidatePath('/me');

  await notifyEmployee(row.employee_id, {
    kind: 'reimbursement',
    title: `Finance ${decision} your reimbursement claim`,
    body:
      decision === 'approved'
        ? `₹${amount.toFixed(2)} — it will be paid with your salary.`
        : `₹${amount.toFixed(2)} — ${cleanRemark}`,
    link: '/me',
  });

  if (decision === 'approved') {
    const warning = await addToPayroll(supabase, row.employee_id, String(row.claim_date).slice(0, 10), amount);
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

  // Edit & resubmit (0035): a REJECTED claim may be corrected and re-filed. The
  // row must land back in 'pending' with every review stamp cleared, so a
  // resubmission never carries a stale approval (the RLS with-check enforces the
  // same rule in Postgres — this is the friendly half).
  const { data: before } = await supabase
    .from('reimbursement_claims')
    .select('status')
    .eq('id', id)
    .maybeSingle<{ status: string }>();
  const wasRejected = before?.status === 'rejected';

  const patch: Record<string, unknown> = {
    claim_date: claimDate,
    description,
    purpose,
    source_medium: sourceMedium,
    kms,
    mode_of_payment: modeOfPayment,
    amount,
    remarks,
  };
  if (wasRejected) {
    patch.status = 'pending';
    patch.reviewed_by = null;
    patch.reviewed_at = null;
    patch.review_remark = null;
    patch.finance_reviewed_by = null;
    patch.finance_reviewed_at = null;
  }

  const { data, error } = await supabase
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .in('status', ['pending', 'rejected'])
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The claim was not updated — it may already have been reviewed, or it is not yours.',
    };
  }

  const { profile } = await getSession();
  await logClaimEvent(supabase, id, {
    action: wasRejected ? 'resubmitted' : 'edited',
    fromStatus: before?.status ?? null,
    toStatus: wasRejected ? 'pending' : before?.status ?? null,
    actorId: profile?.id ?? null,
    actorName: profile?.full_name ?? null,
    metadata: { amount, purpose },
  });

  if (wasRejected) {
    await notifyApprovers(
      {
        kind: 'reimbursement',
        title: `${profile?.full_name ?? 'An employee'} resubmitted a corrected claim`,
        body: `${description} · ₹${amount.toFixed(2)}`,
        link: '/reimbursements',
      },
      profile?.id,
    );
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

/**
 * Mark an approved claim as paid (e.g. settled outside payroll), recording WHO
 * paid it, WHEN, and the payment reference — 'paid' with no such record was
 * unverifiable.
 */
export async function markReimbursementPaid(id: string, paymentRef?: string): Promise<ActionResult> {
  const gate = await requireStaff('Marking a claim paid');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const ref = (paymentRef ?? '').trim() || null;
  const patch: Record<string, unknown> = {
    status: 'paid',
    paid_at: new Date().toISOString(),
    paid_by: gate.profileId,
    payment_ref: ref,
  };

  let { data, error } = await supabase
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .eq('status', 'approved')
    .select('id, employee_id, amount');

  // Migration 0035 not applied yet — fall back to the status-only write rather
  // than refusing a legitimate action.
  if (error?.code === '42703') {
    ({ data, error } = await supabase
      .from('reimbursement_claims')
      .update({ status: 'paid' })
      .eq('id', id)
      .eq('status', 'approved')
      .select('id, employee_id, amount'));
  }

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only an approved claim can be marked paid.' };
  }

  const row = data![0] as { employee_id: string; amount: number | string };
  const { profile } = await getSession();
  await logClaimEvent(supabase, id, {
    action: 'paid',
    fromStatus: 'approved',
    toStatus: 'paid',
    remark: ref ? `Ref ${ref}` : null,
    actorId: gate.profileId,
    actorName: profile?.full_name ?? null,
    metadata: { amount: Number(row.amount), payment_ref: ref },
  });

  await notifyEmployee(row.employee_id, {
    kind: 'reimbursement',
    title: 'Your reimbursement was paid',
    body: `₹${Number(row.amount).toFixed(2)}${ref ? ` · ref ${ref}` : ''}`,
    link: '/me',
  });

  revalidatePath('/reimbursements');
  revalidatePath('/me');
  return { ok: true };
}

/**
 * Attach (or replace) a receipt on a claim the employee owns and that is still
 * open. The file goes to the private reimbursement-receipts bucket (0032) under
 * the employee's own folder, so storage RLS keeps it to them + staff.
 */
export async function uploadReimbursementReceipt(id: string, formData: FormData): Promise<ActionResult> {
  const db = requireDb('Attaching a receipt');
  if (!db.ok) return db;

  const file = formData.get('receipt');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a receipt file.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'Receipts must be 5 MB or smaller.' };

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) return { ok: false, error: 'Your login is not linked to an employee record.' };

  const supabase = await createClient();
  const up = await uploadFile(
    supabase,
    'reimbursement-receipts',
    employeeId,
    file.name,
    await file.arrayBuffer(),
    file.type || undefined,
  );
  if (!up.ok) return { ok: false, error: up.error ?? 'The receipt could not be uploaded.' };

  const { data, error } = await supabase
    .from('reimbursement_claims')
    .update({ receipt_path: up.path })
    .eq('id', id)
    .in('status', ['pending', 'rejected'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The receipt was not attached — the claim may already have been reviewed.' };
  }

  await logClaimEvent(supabase, id, {
    action: 'receipt_attached',
    actorId: profile?.id ?? null,
    actorName: profile?.full_name ?? null,
    metadata: { filename: file.name },
  });

  revalidatePath('/me');
  revalidatePath('/reimbursements');
  return { ok: true };
}

/** Mint a short-lived signed URL for a claim's receipt (owner or staff via RLS). */
export async function getReceiptUrl(claimId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const db = requireDb('Opening a receipt');
  if (!db.ok) return db;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reimbursement_claims')
    .select('receipt_path')
    .eq('id', claimId)
    .maybeSingle<{ receipt_path: string | null }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.receipt_path) return { ok: false, error: 'This claim has no receipt attached.' };

  const signed = await signedUrl(supabase, 'reimbursement-receipts', data.receipt_path);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
}

/** Client-callable timeline fetch for a claim (queries.ts is server-only). */
export async function fetchClaimEvents(claimId: string) {
  return getReimbursementEvents(claimId);
}
