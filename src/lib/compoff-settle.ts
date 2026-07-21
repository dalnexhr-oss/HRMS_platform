// ============================================================================
// Comp-off settlement helpers.
//
// SECURITY: this is deliberately NOT a 'use server' module. These two functions
// used to live in src/lib/actions/compoff.ts, where every export becomes a
// PUBLIC HTTP endpoint with its own action id — and neither had any
// authorization. Any authenticated user could therefore call
// settleApprovedCompOff(requestId) to stamp attendance behind a locked payroll
// run, or releaseCompOff(requestId) to recycle an already-spent credit into a
// free day off. Moving them here removes the action ids, so they are reachable
// only from server code that imports them (reviewRequest).
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireOpenPayrollMonth } from '@/lib/actions/_guard';

/**
 * Close the loop when a comp_off request is APPROVED: stamp the taken day 'CO'
 * and mark the credit used. Called from reviewRequest, which has already
 * verified the caller is staff.
 *
 * Returns a warning string when the side-effects failed, so the caller can tell
 * the reviewer the decision saved but the follow-up did not.
 */
export async function settleApprovedCompOff(requestId: string): Promise<string | null> {
  try {
    const supabase = await createClient();

    const { data: credit, error } = await supabase
      .from('comp_offs')
      .select('id, employee_id, used_date')
      .eq('request_id', requestId)
      .maybeSingle<{ id: string; employee_id: string; used_date: string | null }>();
    if (error) return `Could not load the comp-off credit: ${error.message}`;
    if (!credit) return null; // not a comp-off-backed request

    const takeDate = credit.used_date;
    if (!takeDate) return 'The comp-off credit has no date to apply.';

    // Never stamp a day inside a locked/paid month — the payslips are final.
    const monthOpen = await requireOpenPayrollMonth(supabase, takeDate);
    if (!monthOpen.ok) return `Approved, but the day was not stamped: ${monthOpen.error}`;

    // Preserve any real punches already on that day. The previous version
    // upserted punch_in/punch_out to null, so approving a comp off for a date
    // the employee had actually worked ERASED their punches and worked minutes.
    const { data: existing, error: readErr } = await supabase
      .from('attendance_days')
      .select('punch_in, punch_out, worked_minutes')
      .eq('employee_id', credit.employee_id)
      .eq('work_date', takeDate)
      .maybeSingle<{ punch_in: string | null; punch_out: string | null; worked_minutes: number }>();
    if (readErr) return `Approved, but the existing day could not be read: ${readErr.message}`;

    const { error: dayErr } = await supabase.from('attendance_days').upsert(
      {
        employee_id: credit.employee_id,
        work_date: takeDate,
        status: 'CO',
        punch_in: existing?.punch_in ?? null,
        punch_out: existing?.punch_out ?? null,
        worked_minutes: existing?.worked_minutes ?? 0,
      },
      { onConflict: 'employee_id,work_date' },
    );
    if (dayErr) return `Approved, but the day could not be stamped as comp off: ${dayErr.message}`;

    // Only an 'applied' credit may become 'used' — a credit that is already
    // 'used' must not be re-consumed.
    const { error: useErr } = await supabase
      .from('comp_offs')
      .update({ status: 'used' })
      .eq('id', credit.id)
      .eq('status', 'applied');
    if (useErr) return `Approved, but the comp-off credit was not closed: ${useErr.message}`;

    revalidatePath('/register');
    revalidatePath('/me');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'The comp off could not be settled.';
  }
}

/**
 * Release a credit when its request is rejected or cancelled.
 *
 * Scoped to status='applied' so an already-USED credit can never be resurrected
 * into a fresh day off by replaying a rejection against an old request id.
 */
export async function releaseCompOff(requestId: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase
      .from('comp_offs')
      .update({ status: 'available', used_date: null, request_id: null })
      .eq('request_id', requestId)
      .eq('status', 'applied');
  } catch {
    // Best-effort: a stranded 'applied' credit is recoverable by staff.
  }
}
