'use server';

// ============================================================================
// Paid-leave pool: annual provisioning and audited manual adjustments.
//
// Since the leave-salary policy (migration 0038) there is ONE pool — PL, 15
// days a year. The encashment actions that used to live here died with the
// PL/CL/SL screen; the annual payout is handled by actions/leave-salary.ts.
// The leave_encashment table itself remains (exit full-and-final reads it).
//
// Every write here is staff-gated at the app layer AND by RLS; the SQL
// function carries its own in-body authorisation (0036 header) because
// SECURITY DEFINER routines are reachable over PostgREST.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { notifyEmployee } from '@/lib/notify';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanity bound on a leave year — a typo'd 20265 must not provision anything. */
function validYear(y: number): boolean {
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
}

/**
 * Open a leave year: credit each employee still on the roster the annual
 * paid-leave entitlement (15 days since 0038; PL only).
 *
 * Idempotent by construction (the SQL uses `on conflict do nothing`), so
 * re-running for the same year credits nobody twice — it just reports 0 created.
 */
export async function provisionLeaveYear(year: number): Promise<ActionResult & { created?: number }> {
  const gate = await requireRoles(['super_admin', 'admin', 'hr'], 'Provisioning leave balances');
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
    message: `${profile?.full_name ?? 'A staff user'} provisioned ${created} paid-leave balance row(s) for ${year}`,
    metadata: { year, created },
  });

  revalidatePath('/leave');
  revalidatePath('/me');
  return { ok: true, created };
}

/**
 * Manually credit or debit an employee's paid-leave pool, with a mandatory
 * reason. Hardcoded to PL — the only type the app writes since the pool
 * collapsed to one.
 *
 * Writes BOTH the adjustment row (the audit trail) and the balance itself. The
 * balance row is created when absent, so an adjustment against an unprovisioned
 * year still lands somewhere real rather than silently doing nothing.
 */
export async function adjustLeaveBalance(input: {
  employeeId: string;
  year: number;
  delta: number;
  reason: string;
}): Promise<ActionResult> {
  const gate = await requireRoles(['super_admin', 'admin', 'hr'], 'Adjusting a leave balance');
  if (!gate.ok) return gate;

  const reason = String(input.reason ?? '').trim();
  const delta = Number(input.delta);

  if (!UUID_RE.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  if (!validYear(Number(input.year))) return { ok: false, error: 'Enter a valid year.' };
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
    .insert({ employee_id: input.employeeId, year, type: 'PL', delta, reason, actor_id: gate.profileId })
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
    .eq('type', 'PL')
    .maybeSingle<{ id: string; balance: number | string }>();

  const next = Math.round(((Number(existing?.balance ?? 0) || 0) + delta) * 10) / 10;
  const { error: balErr } = existing
    ? await supabase.from('leave_balances').update({ balance: next }).eq('id', existing.id)
    : await supabase
        .from('leave_balances')
        .insert({ employee_id: input.employeeId, year, type: 'PL', balance: next });

  if (balErr) {
    return {
      ok: false,
      error: `The adjustment was logged, but the balance could not be updated: ${balErr.message}`,
    };
  }

  await notifyEmployee(input.employeeId, {
    kind: 'request',
    title: `Your paid-leave balance was ${delta > 0 ? 'credited' : 'debited'}`,
    body: `${delta > 0 ? '+' : ''}${delta} day(s) for ${year} — ${reason}`,
    link: '/me#leave',
  });

  revalidatePath('/leave');
  revalidatePath('/me');
  return { ok: true };
}
