'use server';

// ============================================================================
// Leave engine: entitlement provisioning, manual balance adjustments and
// encashment (migration 0036).
//
// The gap this closes: nothing ever CREATED a leave_balances row, so
// reviewRequest's drawdown found no row and silently deducted zero — an
// employee could take unlimited "paid" leave and the numbers never moved. HR
// also had no way to correct a balance, and no trace when one changed.
//
// Every write here is staff-gated at the app layer AND by RLS; the SQL
// functions carry their own in-body authorisation (0036 header) because
// SECURITY DEFINER routines are reachable over PostgREST.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireStaff, requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { notifyEmployee } from '@/lib/notify';
import type { LeaveType } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const LEAVE_TYPES: readonly LeaveType[] = ['PL', 'CL', 'SL', 'LWP'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanity bound on a leave year — a typo'd 20265 must not provision anything. */
function validYear(y: number): boolean {
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
}

/**
 * Open a leave year: credit each employee still on the roster their annual
 * entitlement, carrying last year's remainder forward up to the configured cap.
 *
 * Idempotent by construction (the SQL uses `on conflict do nothing`), so
 * re-running for the same year credits nobody twice — it just reports 0 created.
 */
export async function provisionLeaveYear(year: number): Promise<ActionResult & { created?: number }> {
  const gate = await requireRoles(['admin', 'hr'], 'Provisioning leave balances');
  if (!gate.ok) return gate;
  if (!validYear(year)) return { ok: false, error: 'Enter a valid year.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fn_provision_leave_balances', { p_year: year });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, error: 'Leave provisioning is not set up on the database yet — apply migration 0036.' };
    }
    return { ok: false, error: error.message };
  }

  const created = Number(data ?? 0);
  const { profile } = await getSession();
  await supabase.from('activity_log').insert({
    actor_id: gate.profileId,
    event_type: 'leave_provision',
    message: `${profile?.full_name ?? 'A staff user'} provisioned ${created} leave balance row(s) for ${year}`,
    metadata: { year, created },
  });

  revalidatePath('/leave');
  revalidatePath('/me');
  return { ok: true, created };
}

/**
 * Manually credit or debit an employee's balance, with a mandatory reason.
 *
 * Writes BOTH the adjustment row (the audit trail) and the balance itself. The
 * balance row is created when absent, so an adjustment against an unprovisioned
 * year still lands somewhere real rather than silently doing nothing — the exact
 * failure this module exists to end.
 */
export async function adjustLeaveBalance(input: {
  employeeId: string;
  year: number;
  type: string;
  delta: number;
  reason: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Adjusting a leave balance');
  if (!gate.ok) return gate;

  const reason = String(input.reason ?? '').trim();
  const delta = Number(input.delta);
  const type = String(input.type ?? '').trim() as LeaveType;

  if (!UUID_RE.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  if (!validYear(Number(input.year))) return { ok: false, error: 'Enter a valid year.' };
  if (!LEAVE_TYPES.includes(type)) return { ok: false, error: 'Pick a leave type.' };
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: 'Enter a non-zero number of days (negative to debit).' };
  }
  if (Math.abs(delta) > 365) return { ok: false, error: 'That adjustment is implausibly large.' };
  if (!reason) return { ok: false, error: 'A reason is required for a manual adjustment.' };

  const supabase = await createClient();
  const year = Number(input.year);

  // Audit row first: if the balance write then fails, we have a record of the
  // attempt rather than a silent change with no explanation.
  const { data: adj, error: adjErr } = await supabase
    .from('leave_balance_adjustments')
    .insert({ employee_id: input.employeeId, year, type, delta, reason, actor_id: gate.profileId })
    .select('id');
  if (adjErr) {
    if (adjErr.code === '42P01' || adjErr.code === 'PGRST205') {
      return { ok: false, error: 'Leave adjustments are not set up on the database yet — apply migration 0036.' };
    }
    return { ok: false, error: adjErr.message };
  }
  if (wroteNothing(adj)) {
    return { ok: false, error: 'The adjustment was not recorded — your role may lack permission.' };
  }

  const { data: existing } = await supabase
    .from('leave_balances')
    .select('id, balance')
    .eq('employee_id', input.employeeId)
    .eq('year', year)
    .eq('type', type)
    .maybeSingle<{ id: string; balance: number | string }>();

  const next = Math.round(((Number(existing?.balance ?? 0) || 0) + delta) * 10) / 10;
  const { error: balErr } = existing
    ? await supabase.from('leave_balances').update({ balance: next }).eq('id', existing.id)
    : await supabase
        .from('leave_balances')
        .insert({ employee_id: input.employeeId, year, type, balance: next });

  if (balErr) {
    return {
      ok: false,
      error: `The adjustment was logged, but the balance could not be updated: ${balErr.message}`,
    };
  }

  await notifyEmployee(input.employeeId, {
    kind: 'request',
    title: `Your ${type} balance was ${delta > 0 ? 'credited' : 'debited'}`,
    body: `${delta > 0 ? '+' : ''}${delta} day(s) for ${year} — ${reason}`,
    link: '/me',
  });

  revalidatePath('/leave');
  revalidatePath('/me');
  return { ok: true };
}

/**
 * Record an encashment request (HR-initiated — see the 0036 note on why there is
 * no employee INSERT policy). The rupee value is computed at APPROVAL, not here,
 * so a later salary revision cannot rewrite an already-approved amount.
 */
export async function createLeaveEncashment(input: {
  employeeId: string;
  year: number;
  type: string;
  days: number;
  remarks?: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Filing an encashment request');
  if (!gate.ok) return gate;

  const type = String(input.type ?? '').trim() as LeaveType;
  const days = Number(input.days);
  if (!UUID_RE.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  if (!validYear(Number(input.year))) return { ok: false, error: 'Enter a valid year.' };
  if (!LEAVE_TYPES.includes(type)) return { ok: false, error: 'Pick a leave type.' };
  if (!Number.isFinite(days) || days <= 0) return { ok: false, error: 'Enter the number of days to encash.' };

  const supabase = await createClient();

  // Never encash more than the employee actually holds.
  const { data: bal } = await supabase
    .from('leave_balances')
    .select('balance')
    .eq('employee_id', input.employeeId)
    .eq('year', Number(input.year))
    .eq('type', type)
    .maybeSingle<{ balance: number | string }>();
  const available = Number(bal?.balance ?? 0) || 0;
  if (days > available) {
    return { ok: false, error: `Only ${available} day(s) of ${type} are available for ${input.year}.` };
  }

  const { data, error } = await supabase
    .from('leave_encashment')
    .insert({
      employee_id: input.employeeId,
      year: Number(input.year),
      type,
      days,
      remarks: String(input.remarks ?? '').trim() || null,
    })
    .select('id');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'Leave encashment is not set up on the database yet — apply migration 0036.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) return { ok: false, error: 'The request was not filed — your role may lack permission.' };

  revalidatePath('/leave');
  return { ok: true };
}

/**
 * Approve an encashment: value the days from the employee's basic+DA, debit the
 * balance through the SAME audited path as a manual adjustment, and stamp the
 * amount so it is fixed at approval time.
 */
export async function approveLeaveEncashment(id: string): Promise<ActionResult> {
  const gate = await requireRoles(['admin', 'hr'], 'Approving an encashment');
  if (!gate.ok) return gate;
  if (!UUID_RE.test(id)) return { ok: false, error: 'Unknown encashment request.' };

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from('leave_encashment')
    .select('id, employee_id, year, type, days, status')
    .eq('id', id)
    .maybeSingle<{ employee_id: string; year: number; type: LeaveType; days: number | string; status: string }>();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: 'That encashment request no longer exists.' };
  if (row.status !== 'requested') return { ok: false, error: `This request is already ${row.status}.` };

  // Per-day value from basic + DA / 30 — the same monthly-30ths convention the
  // payroll formula uses. Falls back to 0 rather than guessing a salary.
  const { data: emp } = await supabase
    .from('employees')
    .select('basic_da')
    .eq('id', row.employee_id)
    .maybeSingle<{ basic_da: number | string | null }>();
  const perDay = (Number(emp?.basic_da ?? 0) || 0) / 30;
  const days = Number(row.days);
  const amount = Math.round(perDay * days * 100) / 100;

  const { data: updated, error } = await supabase
    .from('leave_encashment')
    .update({ status: 'approved', amount, approved_by: gate.profileId, approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'requested')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(updated)) return { ok: false, error: 'Only a requested encashment can be approved.' };

  // Debit through the audited adjustment path so the balance change is explained.
  const debit = await adjustLeaveBalance({
    employeeId: row.employee_id,
    year: row.year,
    type: row.type,
    delta: -days,
    reason: `Leave encashment approved — ${days} day(s) paid out`,
  });
  if (!debit.ok) {
    return { ok: false, error: `Approved, but the balance debit failed: ${debit.error}` };
  }

  await notifyEmployee(row.employee_id, {
    kind: 'payroll',
    title: 'Your leave encashment was approved',
    body: `${days} day(s) of ${row.type} — ₹${amount.toFixed(2)}`,
    link: '/me',
  });

  revalidatePath('/leave');
  revalidatePath('/me');
  return { ok: true };
}

/** Mark an approved encashment as paid out. */
export async function markEncashmentPaid(id: string): Promise<ActionResult> {
  const gate = await requireStaff('Marking an encashment paid');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leave_encashment')
    .update({ status: 'paid' })
    .eq('id', id)
    .eq('status', 'approved')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'Only an approved encashment can be marked paid.' };

  revalidatePath('/leave');
  return { ok: true };
}
