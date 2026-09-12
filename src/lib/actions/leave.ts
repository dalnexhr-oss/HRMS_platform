'use server';

// Server Actions for paid leave (PL) provisioning and audited manual adjustments.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { toDecimal } from '@/lib/db/money';
import { notifyEmployee } from '@/lib/notify';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sanity bound on a leave year — a typo'd 20265 must not provision anything.
function validYear(y: number): boolean {
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
}

/**
 * Provisions annual paid leave (PL) entitlement for active employees.
 * Idempotent: safe to run multiple times for the same calendar year.
 */
export async function provisionLeaveYear(year: number): Promise<ActionResult & { created?: number }> {
  const gate = await requireRoles(['super_admin', 'admin', 'hr'], 'Provisioning leave balances');
  if (!gate.ok) return gate;
  if (!validYear(year)) return { ok: false, error: 'Enter a valid year.' };

  const dbc = await createClient();
  const { data, error } = await dbc.rpc('fn_provision_leave_balances', { p_year: year });
  if (error) return { ok: false, error: error.message };

  const created = Number(data ?? 0);
  const { profile } = await getSession();
  await dbc.from('activity_log').insert({
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
 * Applies an audited manual credit or debit to an employee's paid-leave (PL) balance.
 * Concurrently inserts an audit trail record in leave_balance_adjustments.
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

  if (!uuidRe.test(String(input.employeeId ?? ''))) return { ok: false, error: 'Pick an employee.' };
  if (!validYear(Number(input.year))) return { ok: false, error: 'Enter a valid year.' };
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: 'Enter a non-zero number of days (negative to debit).' };
  }
  if (Math.abs(delta) > 365) return { ok: false, error: 'That adjustment is implausibly large.' };
  if (!reason) return { ok: false, error: 'A reason is required for a manual adjustment.' };

  const dbc = await createClient();
  const year = Number(input.year);

  // Record audit adjustment entry before balance mutation; written as Decimal128.
  const { data: adj, error: adjErr } = await dbc
    .from('leave_balance_adjustments')
    .insert({
      employee_id: input.employeeId,
      year,
      type: 'PL',
      delta: toDecimal(delta),
      reason,
      actor_id: gate.profileId,
    })
    .select('id');
  if (adjErr) {
    return { ok: false, error: adjErr.message };
  }
  if (wroteNothing(adj)) {
    return { ok: false, error: 'The adjustment was not recorded — your role may lack permission.' };
  }

  const { data: existing } = await dbc
    .from('leave_balances')
    .select('id, balance')
    .eq('employee_id', input.employeeId)
    .eq('year', year)
    .eq('type', 'PL')
    .maybeSingle<{ id: string; balance: number | string }>();

  const next = Math.round(((Number(existing?.balance ?? 0) || 0) + delta) * 10) / 10;
  const { error: balErr } = existing
    ? await dbc.from('leave_balances').update({ balance: toDecimal(next) }).eq('id', existing.id)
    : await dbc
        .from('leave_balances')
        .insert({ employee_id: input.employeeId, year, type: 'PL', balance: toDecimal(next) });

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
