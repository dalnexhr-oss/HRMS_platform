import 'server-only';
import { iso, isoOrNull, fail } from '@/lib/queries/shared';
import { createClient } from '@/lib/db/server-client';

// reimbursements
interface ReimbursementView {
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
  /** Receipt path in private storage, or null when no receipt is attached. */
  receiptPath: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  financeReviewedAt: string | null;
}

const reimbursementFields = `id, employee_id, claim_date, description, purpose, source_medium,
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

/** One lifecycle event on a claim's timeline. */
interface ReimbursementEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  remark: string | null;
  actorName: string | null;
  occurredAt: string;
}

/** A claim's timeline, oldest first (reads as a story). */
async function getReimbursementEvents(claimId: string): Promise<ReimbursementEvent[]> {
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
async function getReimbursements(): Promise<ReimbursementView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('reimbursement_claims')
    .select(reimbursementFields)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getReimbursements: could not load claims', res.error);
  }
  return (res.data ?? []).map(mapReimbursement);
}

/** One employee's own claims, newest first. */
async function getMyReimbursements(employeeId: string): Promise<ReimbursementView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('reimbursement_claims')
    .select(reimbursementFields)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getMyReimbursements: could not load claims', res.error);
  }
  return (res.data ?? []).map(mapReimbursement);
}

/** The ₹/km rate used to auto-calculate travel claims (settings-driven). */
async function getReimbursementRate(): Promise<number> {
  const fallback = 3.5;
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('settings')
    .select('value')
    .eq('key', 'reimbursement_rate_per_km')
    .maybeSingle<{ value: unknown }>();
  if (error || !data) {
    return fallback;
  }
  const n = Number(data.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export { getReimbursementEvents, getReimbursements, getMyReimbursements, getReimbursementRate };

export type { ReimbursementView, ReimbursementEvent };
