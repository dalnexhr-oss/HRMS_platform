'use server';

// Recalculate travel claims on the server using distance × the configured rate. Approval adds the
// claim to the month's payslip adjustment and recomputes pay.
import { queryErrorCodes } from '@/lib/db/errors';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { getReimbursementRate, getReimbursementEvents } from '@/lib/queries';
import { uploadFile, signedUrl, resolveUploadType } from '@/lib/storage';
import { requireDb, requireRoles, requireStaff, wroteNothing } from '@/lib/actions/guards';
import { toDecimal, toMoney } from '@/lib/db/money';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';
import type { ReimbursementPurpose } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
  // The action SUCCEEDED but a side-effect needs attention (payroll run locked, payslip missing,
  // …). ok stays true — see requests.ts.
  warning?: string;
}

const purposes: readonly ReimbursementPurpose[] = ['travel', 'material_purchase', 'other'];
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// Timeline writes are best-effort after the claim is saved. Log failures without reporting the
// committed decision as failed.
async function logClaimEvent(
  dbc: Awaited<ReturnType<typeof createClient>>,
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
  const { error } = await dbc.from('reimbursement_events').insert({
    claim_id: claimId,
    actor_id: input.actorId ?? null,
    actor_name: input.actorName ?? null,
    action: input.action,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    remark: input.remark ?? null,
    metadata: input.metadata ?? {},
  });
  // Audit log write failure is non-blocking (claim action succeeded).
  if (error) {
    console.warn(`[dalnex-hrms] claim event (${input.action}) failed:`, error.message);
  }
}

/** Indicates whether the optional second-stage Finance approval is enabled. */
async function financeStageEnabled(
  dbc: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const { data } = await dbc
    .from('settings')
    .select('value')
    .eq('key', 'reimbursement_finance_stage')
    .maybeSingle<{ value: unknown }>();
  return data?.value === true || data?.value === 'true';
}

/** Parse '1,234.50' / '₹1,234.50' -> 1234.5; null when unparseable. */
function money(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? '')
    .trim()
    .replace(/[,\s₹]/g, '');
  if (!raw) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export async function createReimbursement(formData: FormData): Promise<ActionResult> {
  // validate before touching auth or the network
  const description = String(formData.get('description') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim() as ReimbursementPurpose;
  const claimDate = String(formData.get('claim_date') ?? '').trim();
  const sourceMedium = String(formData.get('source_medium') ?? '').trim() || null;
  const modeOfPayment = String(formData.get('mode_of_payment') ?? '').trim() || null;
  const remarks = String(formData.get('remarks') ?? '').trim() || null;

  if (!description) {
    return { ok: false, error: 'Enter a description.' };
  }
  if (!purposes.includes(purpose)) {
    return { ok: false, error: 'Choose a purpose.' };
  }
  if (!isoDate.test(claimDate)) {
    return { ok: false, error: 'Choose a valid date.' };
  }

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
    if (typed === null || typed <= 0) {
      return { ok: false, error: 'Enter the claim amount.' };
    }
    amount = typed;
  }

  const db = requireDb('Filing a reimbursement claim');
  if (!db.ok) {
    return db;
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return {
      ok: false,
      error:
        'Your login is not linked to an employee record, so a claim cannot be filed. Ask HR to link it.',
    };
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('reimbursement_claims')
    .insert({
      employee_id: employeeId,
      claim_date: claimDate,
      description,
      purpose,
      source_medium: sourceMedium,
      // kms and amount are `decimal` columns — never a JS number.
      kms: kms === null ? null : toDecimal(kms),
      mode_of_payment: modeOfPayment,
      amount: toMoney(amount),
      remarks,
      status: 'pending',
    })
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The claim was not filed — your account may not have permission.' };
  }

  await logClaimEvent(dbc, (data![0] as { id: string }).id, {
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
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  claimDate: string,
  amount: number,
): Promise<string | null> {
  const periodStart = `${claimDate.slice(0, 7)}-01`;

  const { data: run, error: runErr } = await dbc
    .from('payroll_runs')
    .select('id, status')
    .eq('period_month', periodStart)
    .maybeSingle<{ id: string; status: string }>();
  if (runErr) {
    return `Approved, but the payroll run could not be read: ${runErr.message}`;
  }
  if (!run) {
    return `Approved. No payroll run exists for ${periodStart.slice(0, 7)} yet, so it will need adding to that run's adjustments once it is started.`;
  }
  if (run.status === 'locked' || run.status === 'paid') {
    return `Approved, but the ${periodStart.slice(0, 7)} payroll run is ${run.status}, so it could not be added to that payslip. Pay it separately.`;
  }

  const { data: payslip, error: psErr } = await dbc
    .from('payslips')
    .select('id')
    .eq('payroll_run_id', run.id)
    .eq('employee_id', employeeId)
    .maybeSingle<{ id: string }>();
  if (psErr) {
    return `Approved, but the payslip could not be read: ${psErr.message}`;
  }
  if (!payslip) {
    return 'Approved. This employee has no payslip in that run yet — recompute drafts, then it can be added.';
  }

  // Update only if the bonus still matches the value read. Retry concurrent changes so separate
  // approvals cannot lose each other's amounts.
  let applied = false;
  for (let attempt = 0; attempt < 3 && !applied; attempt++) {
    const { data: existing, error: adjErr } = await dbc
      .from('payslip_adjustments')
      .select('id, reimbursement_bonus')
      .eq('id', payslip.id)
      .maybeSingle<{ id: string; reimbursement_bonus: number | string | null }>();
    if (adjErr) {
      return `Approved, but the current adjustments could not be read: ${adjErr.message}`;
    }

    const current = Number(existing?.reimbursement_bonus ?? 0) || 0;
    const next = Math.round((current + amount) * 100) / 100;

    if (!existing) {
      // Insert initial adjustments; on duplicate key conflict (concurrent insert), retry update.
      const { error: insErr } = await dbc
        .from('payslip_adjustments')
        .insert({ id: payslip.id, reimbursement_bonus: toMoney(next), updated_at: new Date() });
      if (insErr && insErr.code !== queryErrorCodes.duplicateKey) {
        return `Approved, but the payslip adjustment failed: ${insErr.message}`;
      }
      applied = !insErr;
      continue;
    }

    const casQuery = dbc
      .from('payslip_adjustments')
      .update({ reimbursement_bonus: toMoney(next), updated_at: new Date() })
      .eq('id', payslip.id);
    // Null needs `is`, a number needs `eq` — the query builder distinguishes them.
    const { data: casRows, error: upErr } = await (
      existing.reimbursement_bonus == null
        ? casQuery.is('reimbursement_bonus', null)
        : casQuery.eq('reimbursement_bonus', existing.reimbursement_bonus)
    ).select('id');
    if (upErr) {
      return `Approved, but the payslip adjustment failed: ${upErr.message}`;
    }
    applied = !!casRows && casRows.length > 0;
  }
  if (!applied) {
    return 'Approved, but the payslip adjustment was contended and could not be applied. Add it manually from the payroll page.';
  }

  const { error: recomputeErr } = await dbc.rpc('fn_compute_payslip', {
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
  if (!gate.ok) {
    return gate;
  }

  // A rejection must say why — the employee sees this note on their dashboard.
  const cleanRemark = (remark ?? '').trim();
  if (decision === 'rejected' && !cleanRemark) {
    return { ok: false, error: 'Enter a reason for rejecting this claim.' };
  }

  const dbc = await createClient();

  // With two-stage review enabled, staff approval routes claim to Finance review.
  const twoStage = decision === 'approved' && (await financeStageEnabled(dbc));
  const nextStatus =
    decision === 'approved' ? (twoStage ? 'finance_review' : 'approved') : 'rejected';

  const patch: Record<string, unknown> = {
    status: nextStatus,
    reviewed_by: gate.profileId,
    reviewed_at: new Date(),
  };
  if (decision === 'rejected') {
    patch.review_remark = cleanRemark;
  }

  const { data, error } = await dbc
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, employee_id, claim_date, amount, purpose, kms');

  if (error) {
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
  // pending claim's kms/amount (a policy scopes rows, not columns) can't inflate pay.
  let finalAmount = Number(row.amount);
  if (decision === 'approved' && row.purpose === 'travel' && row.kms != null) {
    const rate = await getReimbursementRate();
    const corrected = Math.round(Number(row.kms) * rate * 100) / 100;
    if (corrected !== finalAmount) {
      finalAmount = corrected;
      // amount is a `decimal` column — Decimal128, never a JS number.
      await dbc
        .from('reimbursement_claims')
        .update({ amount: toMoney(corrected) })
        .eq('id', id);
    }
  }

  const { profile } = await getSession();
  await logClaimEvent(dbc, id, {
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
    link: '/me#reimbursements',
  });

  // Payroll is credited only on FINAL approval. With the Finance stage on, that
  // is financeReviewReimbursement, not here. A payroll problem is a WARNING on
  // a success — the claim IS approved either way.
  if (decision === 'approved' && !twoStage) {
    const warning = await addToPayroll(
      dbc,
      row.employee_id,
      String(row.claim_date).slice(0, 10),
      finalAmount,
    );
    if (warning) {
      return { ok: true, warning };
    }
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
 * Finalize a claim in finance_review. Admin approval credits payroll; rejection returns it to the
 * employee with a reason.
 */
export async function financeReviewReimbursement(
  id: string,
  decision: 'approved' | 'rejected',
  remark?: string,
): Promise<ActionResult> {
  const gate = await requireRoles(
    ['super_admin', 'admin'],
    `Finance-${decision === 'approved' ? 'approving' : 'rejecting'} a claim`,
  );
  if (!gate.ok) {
    return gate;
  }

  const cleanRemark = (remark ?? '').trim();
  if (decision === 'rejected' && !cleanRemark) {
    return { ok: false, error: 'Enter a reason for rejecting this claim.' };
  }

  const dbc = await createClient();
  const patch: Record<string, unknown> = {
    status: decision === 'approved' ? 'approved' : 'rejected',
    finance_reviewed_by: gate.profileId,
    finance_reviewed_at: new Date(),
  };
  if (decision === 'rejected') {
    patch.review_remark = cleanRemark;
  }

  const { data, error } = await dbc
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .eq('status', 'finance_review')
    .select('id, employee_id, claim_date, amount');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only a claim awaiting Finance approval can be reviewed here.' };
  }

  const row = data![0] as { employee_id: string; claim_date: string; amount: number | string };
  const amount = Number(row.amount);
  const { profile } = await getSession();

  await logClaimEvent(dbc, id, {
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
    link: '/me#reimbursements',
  });

  if (decision === 'approved') {
    const warning = await addToPayroll(
      dbc,
      row.employee_id,
      String(row.claim_date).slice(0, 10),
      amount,
    );
    if (warning) {
      return { ok: true, warning };
    }
  }

  return { ok: true };
}

/**
 * Employee edits their OWN still-pending claim. The write policy restricts it
 * to own + pending/rejected rows; the travel amount is recomputed server-side,
 * exactly as at creation, so it never trusts the browser.
 */
export async function updateReimbursement(id: string, formData: FormData): Promise<ActionResult> {
  const description = String(formData.get('description') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim() as ReimbursementPurpose;
  const claimDate = String(formData.get('claim_date') ?? '').trim();
  const sourceMedium = String(formData.get('source_medium') ?? '').trim() || null;
  const modeOfPayment = String(formData.get('mode_of_payment') ?? '').trim() || null;
  const remarks = String(formData.get('remarks') ?? '').trim() || null;

  if (!description) {
    return { ok: false, error: 'Enter a description.' };
  }
  if (!purposes.includes(purpose)) {
    return { ok: false, error: 'Choose a purpose.' };
  }
  if (!isoDate.test(claimDate)) {
    return { ok: false, error: 'Choose a valid date.' };
  }

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
    if (typed === null || typed <= 0) {
      return { ok: false, error: 'Enter the claim amount.' };
    }
    amount = typed;
  }

  const db = requireDb('Editing a reimbursement claim');
  if (!db.ok) {
    return db;
  }

  const dbc = await createClient();

  // Resubmitting a rejected claim resets status to pending and clears review timestamps.
  const { data: before } = await dbc
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

  const { data, error } = await dbc
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .in('status', ['pending', 'rejected'])
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The claim was not updated — it may already have been reviewed, or it is not yours.',
    };
  }

  const { profile } = await getSession();
  await logClaimEvent(dbc, id, {
    action: wasRejected ? 'resubmitted' : 'edited',
    fromStatus: before?.status ?? null,
    toStatus: wasRejected ? 'pending' : (before?.status ?? null),
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

/** Employee withdraws their OWN still-pending claim. The write policy restricts it to that. */
export async function deleteReimbursement(id: string): Promise<ActionResult> {
  const db = requireDb('Withdrawing a reimbursement claim');
  if (!db.ok) {
    return db;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('reimbursement_claims')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }
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
export async function markReimbursementPaid(
  id: string,
  paymentRef?: string,
): Promise<ActionResult> {
  const gate = await requireStaff('Marking a claim paid');
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();
  const ref = (paymentRef ?? '').trim() || null;
  const patch: Record<string, unknown> = {
    status: 'paid',
    paid_at: new Date(),
    paid_by: gate.profileId,
    payment_ref: ref,
  };

  let { data, error } = await dbc
    .from('reimbursement_claims')
    .update(patch)
    .eq('id', id)
    .eq('status', 'approved')
    .select('id, employee_id, amount');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'Only an approved claim can be marked paid.' };
  }

  const row = data![0] as { employee_id: string; amount: number | string };
  const { profile } = await getSession();
  await logClaimEvent(dbc, id, {
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
    link: '/me#reimbursements',
  });

  revalidatePath('/reimbursements');
  revalidatePath('/me');
  return { ok: true };
}

/** Attaches or replaces a receipt file on an open reimbursement claim owned by the employee. */
export async function uploadReimbursementReceipt(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const db = requireDb('Attaching a receipt');
  if (!db.ok) {
    return db;
  }

  const file = formData.get('receipt');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a receipt file.' };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: 'Receipts must be 5 MB or smaller.' };
  }
  const fileType = resolveUploadType(file.name, 'receipt');
  if (!fileType.ok) {
    return fileType;
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record.' };
  }

  // Check ownership and pending status before uploading to avoid orphaned receipts. Rejected
  // claims must be edited back to pending first.
  const dbc = await createClient();
  const { data: claim, error: claimError } = await dbc
    .from('reimbursement_claims')
    .select('id, status')
    .eq('id', id)
    .eq('employee_id', employeeId)
    .maybeSingle<{ id: string; status: string }>();
  if (claimError) {
    return { ok: false, error: claimError.message };
  }
  if (!claim) {
    return { ok: false, error: 'This claim could not be found.' };
  }
  if (claim.status !== 'pending') {
    return {
      ok: false,
      error:
        'Receipts can only be attached while a claim is pending. Edit the claim to resubmit it first.',
    };
  }

  const up = await uploadFile(
    'reimbursement-receipts',
    employeeId,
    file.name,
    file,
    fileType.contentType,
  );
  if (!up.ok) {
    return { ok: false, error: up.error ?? 'The receipt could not be uploaded.' };
  }

  const { data, error } = await dbc
    .from('reimbursement_claims')
    .update({ receipt_path: up.path })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The receipt was not attached — the claim may already have been reviewed.',
    };
  }

  await logClaimEvent(dbc, id, {
    action: 'receipt_attached',
    actorId: profile?.id ?? null,
    actorName: profile?.full_name ?? null,
    metadata: { filename: file.name },
  });

  revalidatePath('/me');
  revalidatePath('/reimbursements');
  return { ok: true };
}

// Resolve a claim receipt's file URL. The row read scopes it to owner or staff.
export async function getReceiptUrl(
  claimId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const db = requireDb('Opening a receipt');
  if (!db.ok) {
    return db;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('reimbursement_claims')
    .select('receipt_path')
    .eq('id', claimId)
    .maybeSingle<{ receipt_path: string | null }>();
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data?.receipt_path) {
    return { ok: false, error: 'This claim has no receipt attached.' };
  }

  const signed = await signedUrl('reimbursement-receipts', data.receipt_path);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
}

// Client-callable timeline fetch for a claim (queries.ts is server-only).
export async function fetchClaimEvents(claimId: string) {
  return getReimbursementEvents(claimId);
}
