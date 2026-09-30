import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail, iso, isoOrNull } from '@/lib/queries/shared';
import { routingView } from '@/lib/requests/routing-view';
import type { RequestType } from '@/types/database';
import type { RequestRouting } from '@/types/requests';

/** One employee's leave / duty requests, newest first. */
async function getMyRequests(employeeId: string): Promise<RequestView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('requests')
    .select(requestFields)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  // review_remark arrives with 0041 — retry without it until then.
  if (res.error) {
    fail('getMyRequests: could not load requests', res.error);
  }
  return (res.data ?? []).map(mapRequest);
}

// requests
interface RequestView {
  id: string;
  employeeId: string;
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
  /** Decision reason shown to the employee. */
  reviewRemark: string | null;
  /** When the request was submitted (ISO timestamp). */
  createdAt: string;
  /** When it was decided; null while pending/cancelled-unreviewed. */
  reviewedAt: string | null;
  routing: RequestRouting | null;
}

function mapRequest(r: any): RequestView {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name || r.employees?.full_name || '',
    employeeCode: r.employee_code || r.employees?.code || '',
    branch: r.employee_branch || r.employees?.branches?.name || '',
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
    routing: routingView(r.approval_route),
  };
}

const requestFields = `id, employee_id, employee_name, employee_code, employee_branch, approval_route, type, leave_kind, start_date, end_date, days, reason, status,
  balance_after, review_remark, created_at, reviewed_at, employees(code, full_name, branches(name))`;

/** Leave / duty requests, pending first then reviewed. */
async function getRequests(): Promise<RequestView[]> {
  const dbc = await createClient();
  const res = await dbc
    .from('requests')
    .select(requestFields)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getRequests: could not load requests', res.error);
  }
  // Pending first, otherwise preserve newest-first ordering.
  return (res.data ?? [])
    .map(mapRequest)
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
}

/** The same policy-scoped request view is available to staff, the applicant, and tagged people. */
async function getRequest(id: string): Promise<RequestView | null> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('requests')
    .select(requestFields)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    fail('getRequest: could not load the request', error);
  }
  return data ? mapRequest(data) : null;
}

export { getMyRequests, getRequests, getRequest };

export type { RequestView };
