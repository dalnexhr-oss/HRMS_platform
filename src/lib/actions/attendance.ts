'use server';

// ============================================================================
// Server Action for manual attendance corrections.
//
// The register footer promises: "Any manual correction asks for a reason and is
// written to the audit log." This file is what makes that sentence true — it
// upserts attendance_days (stamping is_corrected / correction_reason /
// corrected_by) and then writes an activity_log entry describing who changed
// what and why.
//
// House rule, deliberately honoured here: we never return { ok: true } for a
// write that did not write. Demo mode is NOT a licence to fake a save.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { hhmmToMinutes } from '@/lib/format';
import type { AppRole, AttendanceStatus } from '@/types/database';

export interface CorrectionState {
  ok?: boolean;
  error?: string;
}

/**
 * Roles that may WRITE attendance.
 *
 * Deliberately NOT isStaffRole(). That helper is ['admin','hr','manager','viewer'],
 * which mirrors SQL is_portal() — the READ gate. The write gate is the
 * attendance_days_write policy (0003), which is `using (is_staff())` where
 * is_staff() = ('admin','hr','manager'). 0003's own header says it plainly:
 * "'viewer' is read-only." Authorising viewers here would wave them through the
 * whole drawer only for Postgres to reject the row at the last step.
 *
 * Mirrored in src/app/(portal)/register/page.tsx (a 'use server' module may only
 * export async functions, so this cannot be shared from here).
 */
const WRITE_ROLES: AppRole[] = ['admin', 'hr', 'manager'];

/**
 * Statuses an admin may set from the register.
 *
 * NOTE: migration 0006 adds 'CO' (comp off) to the attendance_status enum, but
 * neither the AttendanceStatus TS union nor STATUS_META know about it yet, so a
 * 'CO' cell would silently render as a "P" stamp (statusMeta falls back to P).
 * Offering it here would write a value the grid then misreports, so it is left
 * out until the type + stamp metadata catch up.
 */
const ALLOWED_STATUSES: AttendanceStatus[] = ['P', 'LM', 'HD', 'L', 'WO', 'OH', 'AB', 'S', 'T'];

function isAllowedStatus(v: string): v is AttendanceStatus {
  return (ALLOWED_STATUSES as string[]).includes(v);
}

/**
 * '' | null -> null (blank is legitimate: no punch). 'HH:MM' / 'HH:MM:SS' ->
 * 'HH:MM'. Anything else is a parse FAILURE, not a blank — returning null for
 * garbage would silently record "no punch" for a value the user actually typed.
 * The range check matters too: '99:99' matches the shape but Postgres would
 * reject it with a cryptic type error.
 */
type TimeParse = { ok: true; value: string | null } | { ok: false };

function timeField(v: FormDataEntryValue | null): TimeParse {
  const s = String(v ?? '').trim();
  if (!s) return { ok: true, value: null };
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return { ok: false };
  const [h, m] = s.split(':').map(Number);
  if (h > 23 || m > 59) return { ok: false };
  return { ok: true, value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

function str(v: FormDataEntryValue | null): string {
  return String(v ?? '').trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Apply a manual correction to one employee/day and record it in the audit log.
 * Restricted to WRITE_ROLES (admin / hr / manager); the attendance_days_write
 * RLS policy enforces the identical rule in Postgres — this is the fast,
 * friendly rejection, not the security boundary.
 */
export async function correctAttendance(formData: FormData): Promise<CorrectionState> {
  // ---------------------------------------------------------------- inputs ---
  const employeeId = str(formData.get('employee_id'));
  const workDate = str(formData.get('work_date'));
  const status = str(formData.get('status'));
  const reason = str(formData.get('reason'));
  const parsedIn = timeField(formData.get('punch_in'));
  const parsedOut = timeField(formData.get('punch_out'));

  // The reason is the whole point of the flow — no reason, no correction.
  if (!reason) {
    return { ok: false, error: 'A correction reason is required.' };
  }
  if (!parsedIn.ok || !parsedOut.ok) {
    return { ok: false, error: 'Punch times must be HH:MM on a 24-hour clock, or left blank.' };
  }
  const punchIn = parsedIn.value;
  const punchOut = parsedOut.value;
  // One punch without the other would store a punch alongside worked_minutes 0 —
  // a row that contradicts itself. Make the user say what they mean.
  if (!punchIn !== !punchOut) {
    return {
      ok: false,
      error: 'Enter both punch in and punch out, or leave both blank — a single punch would record zero hours.',
    };
  }
  if (!UUID_RE.test(employeeId)) {
    return { ok: false, error: 'This row has no database id, so the correction cannot be saved.' };
  }
  if (!DATE_RE.test(workDate)) {
    return { ok: false, error: `Invalid work date: ${workDate || '(missing)'}` };
  }
  if (!isAllowedStatus(status)) {
    return { ok: false, error: `Invalid status: ${status || '(missing)'}` };
  }

  // Worked minutes are derived, never trusted from the client.
  let workedMinutes = 0;
  if (punchIn && punchOut) {
    const from = hhmmToMinutes(punchIn);
    const to = hhmmToMinutes(punchOut);
    // Overnight shifts are not modelled by this day-register, so a backwards
    // pair is a typo, not a night shift. Reject rather than invent 24h of work.
    if (to < from) {
      return { ok: false, error: 'Punch out is before punch in.' };
    }
    workedMinutes = to - from;
  }

  // Demo mode is the ONLY place a fallback is allowed, and a write has no
  // honest fallback: there is nowhere to put the row. Say so.
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Supabase is not configured, so this correction cannot be saved. Demo data is read-only.',
    };
  }

  // ------------------------------------------------------------ authorise ---
  const session = await getSession();
  if (!session.profile) {
    return { ok: false, error: 'Your session has expired. Sign in again to make corrections.' };
  }
  if (!WRITE_ROLES.includes(session.profile.role)) {
    return {
      ok: false,
      error:
        session.profile.role === 'viewer'
          ? 'Your role is read-only, so attendance cannot be corrected. Ask an admin or HR to make this change.'
          : 'Only admin, HR and managers can correct attendance.',
    };
  }

  const supabase = await createClient();

  // Name the employee in the audit message, and prove the id is real.
  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, code, full_name')
    .eq('id', employeeId)
    .maybeSingle();
  if (employeeError) {
    return { ok: false, error: `Could not load the employee: ${employeeError.message}` };
  }
  if (!employee) {
    return { ok: false, error: 'That employee no longer exists.' };
  }

  // A locked/paid run means payslips are final; editing the attendance behind
  // them would silently desync pay from the register (0005 blocks the
  // recompute, so the numbers would simply never catch up).
  const periodMonth = `${workDate.slice(0, 7)}-01`;
  const { data: run, error: runError } = await supabase
    .from('payroll_runs')
    .select('status')
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (runError) {
    return { ok: false, error: `Could not check the payroll run: ${runError.message}` };
  }
  if (run && (run.status === 'locked' || run.status === 'paid')) {
    return {
      ok: false,
      error: `Payroll for this month is ${run.status}. Attendance can no longer be corrected — raise an adjustment instead.`,
    };
  }

  // --------------------------------------------------------------- write ---
  const { data: saved, error: saveError } = await supabase
    .from('attendance_days')
    .upsert(
      {
        employee_id: employeeId,
        work_date: workDate,
        status,
        punch_in: punchIn,
        punch_out: punchOut,
        worked_minutes: workedMinutes,
        is_corrected: true,
        correction_reason: reason,
        corrected_by: session.profile.id,
      },
      { onConflict: 'employee_id,work_date' },
    )
    .select('id')
    .maybeSingle();

  if (saveError) {
    return { ok: false, error: `Could not save the correction: ${saveError.message}` };
  }
  // No error but no row back = RLS silently filtered the write. That is a
  // failure, not a success.
  if (!saved) {
    return {
      ok: false,
      error: 'The correction was not saved — your role may not have permission to write attendance.',
    };
  }

  // ----------------------------------------------------------- audit log ---
  const punchText = punchIn && punchOut ? `${punchIn}–${punchOut}` : 'no punches';
  const actor = session.profile.full_name ?? session.email ?? 'A staff user';
  const { error: logError } = await supabase.from('activity_log').insert({
    actor_id: session.profile.id,
    employee_id: employeeId,
    event_type: 'attendance_correction',
    message: `${actor} corrected ${employee.full_name} (${employee.code}) on ${workDate} to ${status} · ${punchText} — ${reason}`,
    metadata: {
      work_date: workDate,
      status,
      punch_in: punchIn,
      punch_out: punchOut,
      worked_minutes: workedMinutes,
      reason,
      employee_code: employee.code,
    },
  });

  // The attendance row is already committed (PostgREST gives us no transaction
  // across the two writes). Surface the audit failure rather than let the
  // footer's "written to the audit log" promise quietly become false again.
  if (logError) {
    revalidatePath('/register');
    return {
      ok: false,
      error: `Attendance was updated, but the audit-log entry failed: ${logError.message}`,
    };
  }

  revalidatePath('/register');
  return { ok: true };
}
