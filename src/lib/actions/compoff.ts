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
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { getWeekOffPolicy } from '@/lib/queries';
import { isScheduledWeekOff } from '@/lib/week-off';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
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

  const supabase = await createClient();

  // The day must actually be a worked off-day — never take the client's word.
  const { data: day, error: dayErr } = await supabase
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

  const { data, error } = await supabase
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

  await supabase.from('activity_log').insert({
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
    link: '/me',
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
  const compOffId = String(formData.get('comp_off_id') ?? '').trim();
  const takeDate = String(formData.get('take_date') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim() || null;

  if (!compOffId) return { ok: false, error: 'Choose which comp off to use.' };
  if (!ISO_DATE.test(takeDate)) return { ok: false, error: 'Choose a valid date to take off.' };

  const db = requireDb('Applying for a comp off');
  if (!db.ok) return db;

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record. Ask HR to link it.' };
  }

  const supabase = await createClient();

  // Claim the credit first: the status predicate means two concurrent
  // applications for the same credit cannot both succeed.
  const { data: claimed, error: claimErr } = await supabase
    .from('comp_offs')
    .update({ status: 'applied' })
    .eq('id', compOffId)
    .eq('employee_id', employeeId)
    .eq('status', 'available')
    .select('id, earned_date');
  if (claimErr) return { ok: false, error: claimErr.message };
  if (wroteNothing(claimed)) {
    return {
      ok: false,
      error: 'That comp off is no longer available — it may already be applied for or used.',
    };
  }

  const { data: req, error: reqErr } = await supabase
    .from('requests')
    .insert({
      employee_id: employeeId,
      type: 'comp_off',
      start_date: takeDate,
      end_date: takeDate,
      days: 1,
      reason,
      status: 'pending',
    })
    .select('id');

  if (reqErr || wroteNothing(req)) {
    // Release the credit so a failed application doesn't strand it.
    await supabase.from('comp_offs').update({ status: 'available' }).eq('id', compOffId);
    return { ok: false, error: reqErr?.message ?? 'The comp-off request was not filed.' };
  }

  // Link the credit to the request so approval can close the loop.
  await supabase
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
