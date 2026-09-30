'use server';

// Manually close open attendance days at the configured auto punch-out time, recompute worked
// minutes, and write an audit entry.
//
// Scheduled sweeps use db/scheduled-jobs.ts instead: they run with system scope and default to
// yesterday, whereas this action requires a staff session and defaults to today.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server-client';
import { todayIST } from '@/lib/display-formatting';
import { requireStaff, requireOpenPayrollMonth } from '@/lib/actions/guards';
import { getAutoPunchOutMinutes, minutesToClock } from '@/lib/attendance-rules';
import { closePunchDay } from '@/lib/punch-storage';

type SweepResult =
  { ok: true; closed: number; at: string; date: string } | { ok: false; error: string };

interface OpenDay {
  id: string;
  employee_id: string;
  work_date: string;
  punch_in: string | null;
}

// Close every open day on `dateISO` ('YYYY-MM-DD'). Defaults to today in the business timezone
// (Asia/Kolkata) — the sweep is a same-evening job.
async function runNightSweep(dateISO?: string): Promise<SweepResult> {
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
      try {
        if (await closePunchDay(row.id, autoOutMin, 'manual', gate.profileId)) {
          closed++;
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Could not close this day.');
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

    revalidatePath('/dashboard');
    revalidatePath('/monthly-register');
    revalidatePath('/employee');
    return { ok: true, closed, at: minutesToClock(autoOutMin), date };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The night sweep failed.' };
  }
}

export { runNightSweep };
export type { SweepResult };
