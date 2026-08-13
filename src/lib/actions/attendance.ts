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
// write that did not write. A missing database is NOT a licence to fake a save.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { hhmmToMinutes } from '@/lib/format';
import { requireStaff, requireOpenPayrollMonth } from '@/lib/actions/_guard';
import type { AppRole, AttendanceStatus } from '@/types/database';

export interface CorrectionState {
  ok?: boolean;
  error?: string;
  /** The write SUCCEEDED but a follow-up needs attention (e.g. the audit-log
   *  entry failed). ok stays true — see requests.ts. */
  warning?: string;
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
 * 'CO' (comp off) was withheld here while the AttendanceStatus union and
 * STATUS_META lacked it — a written 'CO' would have rendered as a "P" stamp.
 * Both now carry it (and 0009 makes comp off a real lifecycle), so it is
 * offered. Note the normal path for a comp off is the employee applying against
 * an earned credit; setting it here is the manual override.
 */
const ALLOWED_STATUSES: AttendanceStatus[] = ['P', 'LM', 'HD', 'L', 'WO', 'OH', 'AB', 'S', 'T', 'CO'];

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

  // A write has no honest fallback: without a database there is nowhere to put
  // the row. Say so rather than faking a save.
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Supabase is not configured, so this correction cannot be saved.',
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
  // them would silently desync pay from the register. requireOpenPayrollMonth
  // also honours month_closed_at — the attendance seal the auto-close cron
  // (0033) stamps. The old inline check here read only `status`, so a sealed
  // month refused by the BULK path was still editable one cell at a time.
  const open = await requireOpenPayrollMonth(supabase, workDate);
  if (!open.ok) return open;

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

  // ------------------------------------------------- comp-off availment ---
  // A manual 'CO' stamp is an availment too: close the employee's oldest
  // usable credit so the balance drops, exactly as the approval path does.
  // Without this, the register override left the credit 'available' forever.
  // Best-effort: the day is already stamped, so a credit problem is a WARNING.
  let compOffWarning: string | null = null;
  if (status === 'CO') {
    // Idempotence: re-saving the same day must not spend a second credit.
    const { data: already } = await supabase
      .from('comp_offs')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('used_date', workDate)
      .in('status', ['applied', 'used'])
      .limit(1);
    if (!already || already.length === 0) {
      let fifo = await supabase
        .from('comp_offs')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('status', 'available')
        .eq('is_applicable', true)
        .order('expires_on', { ascending: true, nullsFirst: false })
        .order('earned_date', { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();
      // expires_on / is_applicable may predate 0036/0041 on this database.
      if (fifo.error?.code === '42703') {
        fifo = (await supabase
          .from('comp_offs')
          .select('id')
          .eq('employee_id', employeeId)
          .eq('status', 'available')
          .order('earned_date', { ascending: true })
          .limit(1)
          .maybeSingle<{ id: string }>()) as typeof fifo;
      }
      if (fifo.data?.id) {
        const { error: spendErr } = await supabase
          .from('comp_offs')
          .update({ status: 'used', used_date: workDate })
          .eq('id', fifo.data.id)
          .eq('status', 'available');
        if (spendErr) {
          compOffWarning = `The day was stamped CO, but the comp-off credit could not be closed: ${spendErr.message}`;
        }
      } else if (!fifo.error) {
        compOffWarning =
          'The day was stamped CO, but this employee has no usable comp-off credit to deduct — the balance was not reduced.';
      }
    }
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
  // across the two writes). Surface the audit failure as a WARNING on a
  // success — the correction itself is saved, and screens must show it as such.
  revalidatePath('/register');
  if (status === 'CO') revalidatePath('/me'); // the employee's balance moved
  const warnings = [
    compOffWarning,
    logError ? `Attendance was updated, but the audit-log entry failed: ${logError.message}` : null,
  ].filter(Boolean);
  if (warnings.length > 0) {
    return { ok: true, warning: warnings.join(' ') };
  }
  return { ok: true };
}

export interface BulkTarget {
  employeeId: string;
  workDate: string;
}

/**
 * Apply ONE status to MANY employee/day cells in a single reasoned correction.
 *
 * Mirrors correctAttendance's guarantees at scale: staff-only, reason required,
 * every closed/locked month refused (the WHOLE batch, not silently partial —
 * mixed success is worse than an honest refusal), each row stamped is_corrected
 * with the reason, and ONE audit-log summary row for the batch. Punches are
 * cleared: a bulk status set ("mark these days L") is a day-status change, not a
 * punch edit, so worked_minutes goes to 0.
 */
export async function correctAttendanceBulk(input: {
  targets: BulkTarget[];
  status: string;
  reason: string;
}): Promise<CorrectionState> {
  const reason = String(input.reason ?? '').trim();
  const status = String(input.status ?? '').trim();
  const targets = Array.isArray(input.targets) ? input.targets : [];

  if (!reason) return { ok: false, error: 'A correction reason is required.' };
  if (!isAllowedStatus(status)) return { ok: false, error: `Invalid status: ${status || '(missing)'}` };
  if (targets.length === 0) return { ok: false, error: 'Select at least one day to correct.' };
  if (targets.length > 2000) return { ok: false, error: 'Too many cells at once — narrow the selection.' };

  for (const t of targets) {
    if (!UUID_RE.test(t.employeeId) || !DATE_RE.test(t.workDate)) {
      return { ok: false, error: 'One of the selected cells is invalid, so nothing was changed.' };
    }
  }

  const gate = await requireStaff('Bulk-correcting attendance');
  if (!gate.ok) return gate;

  const supabase = await createClient();

  // Refuse the whole batch if ANY touched month is locked/paid/closed. One
  // check per MONTH, not per date — a 31-day sweep used to issue 31 identical
  // payroll_runs queries before writing a single row.
  const months = [...new Set(targets.map((t) => t.workDate.slice(0, 7)))];
  for (const month of months) {
    const open = await requireOpenPayrollMonth(supabase, `${month}-01`);
    if (!open.ok) return open;
  }

  const rows = targets.map((t) => ({
    employee_id: t.employeeId,
    work_date: t.workDate,
    status,
    punch_in: null,
    punch_out: null,
    worked_minutes: 0,
    is_corrected: true,
    correction_reason: reason,
    corrected_by: gate.profileId,
  }));

  const { data: saved, error: saveError } = await supabase
    .from('attendance_days')
    .upsert(rows, { onConflict: 'employee_id,work_date' })
    .select('id');
  if (saveError) return { ok: false, error: `Could not save the corrections: ${saveError.message}` };
  if (!saved || saved.length === 0) {
    return { ok: false, error: 'No rows were written — your role may not have permission to write attendance.' };
  }

  const { profile } = await getSession();
  const actor = profile?.full_name ?? 'A staff user';
  const { error: logError } = await supabase.from('activity_log').insert({
    actor_id: gate.profileId,
    employee_id: null,
    event_type: 'attendance_correction',
    message: `${actor} bulk-set ${saved.length} day(s) to ${status} — ${reason}`,
    metadata: { status, reason, count: saved.length, bulk: true },
  });
  revalidatePath('/register');
  if (logError) {
    return { ok: true, warning: `Corrections saved, but the audit-log entry failed: ${logError.message}` };
  }
  return { ok: true };
}
