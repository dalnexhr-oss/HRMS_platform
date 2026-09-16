// Internal comp-off settlement helpers. Keep these outside use-server modules; reviewRequest
// authorizes the caller before invoking them.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireOpenPayrollMonth } from '@/lib/actions/guards';

// Stamp the approved day CO before marking its credit used. The adapter cannot share a transaction
// here. If the second write fails, the credit stays applied and cannot be spent again; reversing
// the writes could consume a credit without recording the day off. Return follow-up failures as
// warnings after the decision has saved.
export async function settleApprovedCompOff(requestId: string): Promise<string | null> {
  try {
    const dbc = await createClient();

    const { data: credit, error } = await dbc
      .from('comp_offs')
      .select('id, employee_id, used_date')
      .eq('request_id', requestId)
      .maybeSingle<{ id: string; employee_id: string; used_date: string | null }>();
    if (error) {
      return `Could not load the comp-off credit: ${error.message}`;
    }
    if (!credit) {
      // not a comp-off-backed request
      return null;
    }

    const takeDate = credit.used_date;
    if (!takeDate) {
      return 'The comp-off credit has no date to apply.';
    }

    // Never stamp a day inside a locked/paid month — the payslips are final.
    const monthOpen = await requireOpenPayrollMonth(dbc, takeDate);
    if (!monthOpen.ok) {
      return `Approved, but the day was not stamped: ${monthOpen.error}`;
    }

    // Preserve any real punches already on that day. The previous version
    // upserted punch_in/punch_out to null, so approving a comp off for a date
    // the employee had actually worked ERASED their punches and worked minutes.
    const { data: existing, error: readErr } = await dbc
      .from('attendance_days')
      .select('punch_in, punch_out, worked_minutes')
      .eq('employee_id', credit.employee_id)
      .eq('work_date', takeDate)
      .maybeSingle<{ punch_in: string | null; punch_out: string | null; worked_minutes: number }>();
    if (readErr) {
      return `Approved, but the existing day could not be read: ${readErr.message}`;
    }

    const { error: dayErr } = await dbc.from('attendance_days').upsert(
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
    if (dayErr) {
      return `Approved, but the day could not be stamped as comp off: ${dayErr.message}`;
    }

    // Only an 'applied' credit may become 'used' — a credit that is already
    // 'used' must not be re-consumed.
    const { error: useErr } = await dbc
      .from('comp_offs')
      .update({ status: 'used' })
      .eq('id', credit.id)
      .eq('status', 'applied');
    if (useErr) {
      return `Approved, but the comp-off credit was not closed: ${useErr.message}`;
    }

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
    const dbc = await createClient();
    await dbc
      .from('comp_offs')
      .update({ status: 'available', used_date: null, request_id: null })
      .eq('request_id', requestId)
      .eq('status', 'applied');
  } catch {
    // Best-effort: a stranded 'applied' credit is recoverable by staff.
  }
}
