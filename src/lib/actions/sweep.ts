'use server';

// ============================================================================
// Night sweep — close attendance days that have a punch-in but no punch-out.
//
// An open day reads as zero worked minutes, which silently inflates the payroll
// hours-shortfall deduction, so every open day is closed at the configured
// auto punch-out time (default 18:00, settings.auto_punch_out_time) and the
// worked minutes recomputed. Every sweep writes one activity_log entry so the
// correction is auditable rather than invisible.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff, requireOpenPayrollMonth } from '@/lib/actions/_guard';
import {
  autoCloseDay,
  clockToMinutes,
  getAutoPunchOutMinutes,
  minutesToClock,
} from '@/lib/attendance-rules';

export type SweepResult =
  | { ok: true; closed: number; at: string; date: string }
  | { ok: false; error: string };

interface OpenDay {
  id: string;
  employee_id: string;
  work_date: string;
  punch_in: string | null;
}

/**
 * Close every open day on `dateISO` ('YYYY-MM-DD'). Defaults to today in the
 * business timezone (Asia/Kolkata) — the sweep is a same-evening job.
 */
export async function runNightSweep(dateISO?: string): Promise<SweepResult> {
  const gate = await requireStaff('Running the night sweep');
  if (!gate.ok) return gate;

  try {
    const date =
      dateISO ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const supabase = await createClient();

    // The date is caller-supplied, so without this a staff user could sweep an
    // arbitrary PAST date and mass-rewrite punch_out values behind an already
    // locked/paid payroll month.
    const monthOpen = await requireOpenPayrollMonth(supabase, date);
    if (!monthOpen.ok) return { ok: false, error: monthOpen.error };

    const autoOutMin = await getAutoPunchOutMinutes();

    const { data, error } = await supabase
      .from('attendance_days')
      .select('id, employee_id, work_date, punch_in')
      .eq('work_date', date)
      .not('punch_in', 'is', null)
      .is('punch_out', null);
    if (error) return { ok: false, error: `Could not read open days: ${error.message}` };

    const open = (data ?? []) as OpenDay[];
    if (open.length === 0) {
      return { ok: true, closed: 0, at: minutesToClock(autoOutMin), date };
    }

    let closed = 0;
    const failures: string[] = [];

    for (const row of open) {
      const inMin = clockToMinutes(row.punch_in);
      const result = autoCloseDay(inMin, null, autoOutMin);
      if (!result) continue; // unparseable punch-in — leave it for a human

      const { error: updErr, data: updated } = await supabase
        .from('attendance_days')
        .update({
          punch_out: minutesToClock(result.outMin),
          worked_minutes: result.workedMin,
        })
        .eq('id', row.id)
        // Only close it if it is still open — a real punch-out landing mid-sweep wins.
        .is('punch_out', null)
        .select('id');
      if (updErr) {
        failures.push(updErr.message);
        continue;
      }
      if (updated && updated.length > 0) closed++;
    }

    if (closed === 0 && failures.length > 0) {
      return { ok: false, error: `The sweep closed nothing: ${failures[0]}` };
    }

    if (closed > 0) {
      await supabase.from('activity_log').insert({
        actor_id: gate.profileId,
        event_type: 'night_sweep',
        message: `Night sweep closed ${closed} open session${closed === 1 ? '' : 's'} for ${date} — auto punched-out at ${minutesToClock(autoOutMin)}.`,
        metadata: { work_date: date, closed, auto_punch_out: minutesToClock(autoOutMin) },
      });
    }

    revalidatePath('/today');
    revalidatePath('/register');
    return { ok: true, closed, at: minutesToClock(autoOutMin), date };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The night sweep failed.' };
  }
}
