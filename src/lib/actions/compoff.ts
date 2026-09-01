'use server';

// ============================================================================
// Comp-off lifecycle.
//
//   EARNED   staff grant a credit from the register when an employee worked an
//            off day (a WO/OH-stamped day carrying punches).
//   APPLIED  the employee applies for a day off against an available credit;
//            this raises a normal request(type='comp_off') so it lands in the
//            staff approvals queue.
//   USED     on approval the taken day is stamped 'CO' in attendance_days and
//            the credit is closed with its used_date. See reviewRequest().
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { getWeekOffPolicy } from '@/lib/queries';
import { isScheduledWeekOff } from '@/lib/week-off';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { toDecimal } from '@/lib/db/money';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Statuses that mean "this was a day off". Working one of these earns a credit.
// NOT exported: this file carries the 'use server' directive, and Next.js allows
// a "use server" module to export only async functions — a `const` export throws
// "A 'use server' file can only export async functions, found object" the moment
// the module enters a client bundle. The constant is only used inside this file.
const OFF_DAY_STATUSES = ['WO', 'OH'] as const;

/**
 * Grant a comp-off credit for an off day the employee worked.
 * The unique (employee_id, earned_date) constraint makes a double-grant a
 * no-op error rather than a duplicate credit.
 */
export async function grantCompOff(employeeId: string, earnedDate: string): Promise<ActionResult> {
  const gate = await requireStaff('Granting a comp off');
  if (!gate.ok) return gate;

  if (!ISO_DATE.test(earnedDate)) return { ok: false, error: 'Invalid date for the comp off.' };

  const dbc = await createClient();

  // The day must actually be a worked off-day — never take the client's word.
  const { data: day, error: dayErr } = await dbc
    .from('attendance_days')
    .select('status, punch_in, worked_minutes')
    .eq('employee_id', employeeId)
    .eq('work_date', earnedDate)
    .maybeSingle<{ status: string; punch_in: string | null; worked_minutes: number }>();
  if (dayErr) return { ok: false, error: `Could not read that day: ${dayErr.message}` };
  if (!day) return { ok: false, error: 'No attendance is recorded for that day.' };

  // A day is "off" either by its stamp (WO/OH) or by the schedule — a Sunday or
  // a 1st/3rd/5th Saturday. The schedule arm is what makes a worked non-working
  // Saturday grantable even though it is usually stamped plain 'P'.
  const policy = await getWeekOffPolicy();
  const isOffDay =
    (OFF_DAY_STATUSES as readonly string[]).includes(day.status) ||
    isScheduledWeekOff(earnedDate, policy);
  const worked = day.punch_in !== null || Number(day.worked_minutes) > 0;
  if (!isOffDay || !worked) {
    return {
      ok: false,
      error: 'A comp off can only be granted for a week-off or holiday that was actually worked.',
    };
  }

  const { data, error } = await dbc
    .from('comp_offs')
    .insert({ employee_id: employeeId, earned_date: earnedDate, granted_by: gate.profileId })
    .select('id');

  if (error) {
    // 23505 = unique_violation: a credit for this day already exists.
    if (error.code === '23505') {
      return { ok: false, error: 'A comp off has already been granted for that day.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The comp off was not granted — your role may lack permission.' };
  }

  await dbc.from('activity_log').insert({
    actor_id: gate.profileId,
    employee_id: employeeId,
    event_type: 'comp_off_granted',
    message: `Comp off granted for ${earnedDate} (worked on an off day).`,
    metadata: { earned_date: earnedDate },
  });

  await notifyEmployee(employeeId, {
    kind: 'comp_off',
    title: 'You earned a comp off',
    body: `For working on ${earnedDate}. Apply for a day off from your dashboard.`,
    link: '/me#comp-offs',
  });

  revalidatePath('/register');
  revalidatePath('/me');
  return { ok: true };
}

/**
 * Employee applies to take a day off against one of their available credits.
 * Raises a request(type='comp_off') and marks the credit 'applied' so it cannot
 * be spent twice while the request is pending.
 */
export async function applyCompOff(formData: FormData): Promise<ActionResult> {
  const requestedId = String(formData.get('comp_off_id') ?? '').trim();
  const takeDate = String(formData.get('take_date') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim() || null;

  if (!ISO_DATE.test(takeDate)) return { ok: false, error: 'Choose a valid date to take off.' };

  const db = requireDb('Applying for a comp off');
  if (!db.ok) return db;

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record. Ask HR to link it.' };
  }

  const dbc = await createClient();

  // FIFO (0036): with no explicit credit chosen, spend the one that expires
  // SOONEST — oldest expiry first, then oldest earned. Letting the employee
  // always pick freely means the near-expiry credits quietly lapse while newer
  // ones get used, which is the whole reason expiry dates exist.
  let compOffId = requestedId;
  if (!compOffId) {
    const { data: oldest, error: fifoErr } = await dbc
      .from('comp_offs')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('status', 'available')
      // A credit staff put on hold (0041) must not be picked for the employee.
      .eq('is_applicable', true)
      // nullsFirst:false so dated credits are consumed before undated ones —
      // an undated credit cannot lapse, so it can safely wait.
      .order('expires_on', { ascending: true, nullsFirst: false })
      .order('earned_date', { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (fifoErr) return { ok: false, error: fifoErr.message };
    compOffId = oldest?.id ?? '';
    if (!compOffId) return { ok: false, error: 'You have no usable comp off to apply for.' };
  }

  // Claim the credit first: the status predicate means two concurrent
  // applications for the same credit cannot both succeed, and the
  // is_applicable predicate refuses a credit staff put on hold.
  const claim = await dbc
    .from('comp_offs')
    .update({ status: 'applied' })
    .eq('id', compOffId)
    .eq('employee_id', employeeId)
    .eq('status', 'available')
    .eq('is_applicable', true)
    .select('id, earned_date');
  const { data: claimed, error: claimErr } = claim;
  if (claimErr) return { ok: false, error: claimErr.message };
  if (wroteNothing(claimed)) {
    return {
      ok: false,
      error:
        'That comp off cannot be used — it may already be applied for or used, or HR has marked it not applicable.',
    };
  }

  const { data: req, error: reqErr } = await dbc
    .from('requests')
    .insert({
      employee_id: employeeId,
      type: 'comp_off',
      start_date: takeDate,
      end_date: takeDate,
      // requests.days is a `decimal` column, so even a whole 1 goes in as
      // Decimal128 — an int32 is rejected by the validator.
      days: toDecimal(1),
      reason,
      status: 'pending',
    })
    .select('id');

  if (reqErr || wroteNothing(req)) {
    // Release the credit so a failed application doesn't strand it.
    await dbc.from('comp_offs').update({ status: 'available' }).eq('id', compOffId);
    return { ok: false, error: reqErr?.message ?? 'The comp-off request was not filed.' };
  }

  // Link the credit to the request so approval can close the loop.
  await dbc
    .from('comp_offs')
    .update({ request_id: req![0].id, used_date: takeDate })
    .eq('id', compOffId);

  await notifyApprovers(
    {
      kind: 'request',
      title: `${profile?.full_name ?? 'An employee'} applied to take a comp off`,
      body: takeDate,
      link: '/approvals',
    },
    profile?.id,
  );

  revalidatePath('/me');
  revalidatePath('/approvals');
  return { ok: true };
}

/**
 * Staff switch (0041): mark an AVAILABLE credit applicable / not applicable.
 * A not-applicable credit stays on the books and keeps its expiry, but the
 * employee cannot apply against it until it is switched back.
 */
export async function setCompOffApplicability(
  id: string,
  applicable: boolean,
): Promise<ActionResult> {
  const gate = await requireStaff('Updating a comp off');
  if (!gate.ok) return gate;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Unknown comp off.' };

  const dbc = await createClient();
  // Only an available credit can be toggled: an applied one is already in the
  // approvals queue, and used/expired credits are history.
  const { data, error } = await dbc
    .from('comp_offs')
    .update({ is_applicable: applicable })
    .eq('id', id)
    .eq('status', 'available')
    .select('id, employee_id, earned_date');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'Only an available credit can be switched — this one is already applied for, used or expired.',
    };
  }

  const row = data![0] as { employee_id: string; earned_date: string };
  await dbc.from('activity_log').insert({
    actor_id: gate.profileId,
    employee_id: row.employee_id,
    event_type: 'comp_off_applicability',
    message: `Comp off earned ${row.earned_date} marked ${applicable ? 'applicable' : 'not applicable'}.`,
    metadata: { comp_off_id: id, earned_date: row.earned_date, is_applicable: applicable },
  });
  await notifyEmployee(row.employee_id, {
    kind: 'comp_off',
    title: applicable ? 'A comp off is available again' : 'A comp off was put on hold',
    body: applicable
      ? `Your comp off earned on ${row.earned_date} can be applied for again.`
      : `Your comp off earned on ${row.earned_date} was marked not applicable by HR.`,
    link: '/me#comp-offs',
  });

  revalidatePath('/today');
  revalidatePath('/me');
  return { ok: true };
}
