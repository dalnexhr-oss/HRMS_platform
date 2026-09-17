'use server';

// Manually close open attendance days at the configured auto punch-out time, recompute worked
// minutes, and write an audit entry.
//
// Scheduled sweeps use db/scheduler.ts instead: they run with system scope and default to
// yesterday, whereas this action requires a staff session and defaults to today.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { todayIST } from '@/lib/format';
import { requireStaff, requireOpenPayrollMonth } from '@/lib/actions/guards';
import { autoCloseDay, clockToMinutes, getAutoPunchOutMinutes, minutesToClock } from '@/lib/attendance-rules';

export type SweepResult =
  { ok: true; closed: number; at: string; date: string } | { ok: false; error: string };

interface OpenDay {
  id: string;
  employee_id: string;
  work_date: string;
  punch_in: string | null;
}

// Close every open day on `dateISO` ('YYYY-MM-DD'). Defaults to today in the business timezone
// (Asia/Kolkata) — the sweep is a same-evening job.
export async function runNightSweep(dateISO?: string): Promise<SweepResult> {
  const gate = await requireStaff('Running the night sweep');
  if (!gate.ok) {
    return gate;
  }

  try {
    const date = dateISO ?? todayIST();

    const dbc = await createClient();

    // Caller-supplied dates must respect the same payroll seal as attendance corrections.
    const monthOpen = await requireOpenPayrollMonth(dbc, date);
    if (!monthOpen.ok) {
      return { ok: false, error: monthOpen.error };
    }

    const autoOutMin = await getAutoPunchOutMinutes();

    const { data, error } = await dbc
      .from('attendance_days')
      .select('id, employee_id, work_date, punch_in')
      .eq('work_date', date)
      .not('punch_in', 'is', null)
      .is('punch_out', null);
    if (error) {
      return { ok: false, error: `Could not read open days: ${error.message}` };
    }

    const open = (data ?? []) as OpenDay[];
    if (open.length === 0) {
      return { ok: true, closed: 0, at: minutesToClock(autoOutMin), date };
    }

    let closed = 0;
    const failures: string[] = [];

    for (const row of open) {
      const inMin = clockToMinutes(row.punch_in);
      const result = autoCloseDay(inMin, null, autoOutMin);
      if (!result) {
        // unparseable punch-in — leave it for a human
        continue;
      }

      const { error: updErr, data: updated } = await dbc
        .from('attendance_days')
        .update({
          punch_out: minutesToClock(result.outMin),
          worked_minutes: result.workedMin,
          is_corrected: true,
          correction_reason: 'Manual night sweep: no closing punch was recorded.',
          corrected_by: gate.profileId,
          auto_close_source: 'manual',
          auto_closed_at: new Date(),
        })
        .eq('id', row.id)
        // Only close it if it is still open — a real punch-out landing mid-sweep wins.
        .is('punch_out', null)
        .select('id');
      if (updErr) {
        failures.push(updErr.message);
        continue;
      }
      if (updated && updated.length > 0) {
        closed++;
      }
    }

    if (closed === 0 && failures.length > 0) {
      return { ok: false, error: `The sweep closed nothing: ${failures[0]}` };
    }

    if (closed > 0) {
      await dbc.from('activity_log').insert({
        actor_id: gate.profileId,
        event_type: 'night_sweep',
        message: `Night sweep closed ${closed} open session${closed === 1 ? '' : 's'} for ${date} — auto punched-out at ${minutesToClock(autoOutMin)}.`,
        metadata: { work_date: date, closed, auto_punch_out: minutesToClock(autoOutMin) },
      });
    }

    revalidatePath('/today');
    revalidatePath('/register');
    revalidatePath('/me');
    return { ok: true, closed, at: minutesToClock(autoOutMin), date };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The night sweep failed.' };
  }
}
