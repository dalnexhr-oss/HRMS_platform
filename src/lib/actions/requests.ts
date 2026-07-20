'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { requireStaff } from '@/lib/actions/_guard';
import type { LeaveType, RequestType } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const REQUEST_TYPES: readonly RequestType[] = ['leave', 'site_visit', 'outdoor_duty', 'wfh'];
const LEAVE_KINDS: readonly LeaveType[] = ['PL', 'CL', 'SL', 'LWP'];

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

/** Revalidate both surfaces a request appears on: the employee's own dashboard
 *  and the staff approvals queue. */
function revalidateRequestViews(): void {
  revalidatePath('/me');
  revalidatePath('/approvals');
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
): Promise<ActionResult> {
  // Staff-only, DB required. requireStaff also covers the demo-mode refusal.
  const gate = await requireStaff(`Marking a request ${decision}`);
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('requests')
    .update({ status: decision, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: error.message };

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'The request was not updated — it may already have been reviewed by someone else, or your account may not have permission to review it.',
    };
  }

  revalidateRequestViews();
  return { ok: true };
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
    if (!LEAVE_KINDS.includes(raw)) {
      return { ok: false, error: 'Pick a leave type (PL / CL / SL / LWP).' };
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

  const days = inclusiveDays(start, end);
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
  const { error } = await supabase.from('requests').insert({
    employee_id: employeeId,
    type,
    leave_kind: leaveKind,
    start_date: startRaw,
    end_date: endRaw,
    days,
    reason,
    status: 'pending',
  });
  if (error) return { ok: false, error: error.message };

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
    .select('id');
  if (error) return { ok: false, error: error.message };

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'The request was not cancelled — it may already have been reviewed, or your account may not have permission to withdraw it.',
    };
  }

  revalidateRequestViews();
  return { ok: true };
}
