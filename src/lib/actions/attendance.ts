'use server';

// Save manual attendance corrections with the reason and actor, then record the change in
// activity_log. Failed writes must return an error.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { isMongoConfigured } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { hhmmToMinutes } from '@/lib/format';
import { requireStaff, requireOpenPayrollMonth } from '@/lib/actions/guards';
import type { AppRole, AttendanceStatus } from '@/types/database';

export interface CorrectionState {
  ok?: boolean;
  error?: string;
  // The write SUCCEEDED but a follow-up needs attention (e.g. the audit-log entry failed). ok stays
  // true — see requests.ts.
  warning?: string;
}

// Authorized roles permitted to update attendance records.
const writeRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// Statuses available for manual override in the attendance register.
const allowedStatuses: AttendanceStatus[] = [
  'P',
  'LM',
  'HD',
  'L',
  'WO',
  'OH',
  'AB',
  'S',
  'T',
  'CO',
];

function isAllowedStatus(v: string): v is AttendanceStatus {
  return (allowedStatuses as string[]).includes(v);
}

// Parses and validates HH:MM or HH:MM:SS time strings, normalizing to HH:MM format.
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

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Apply a manual correction to one employee/day and record it in the audit log.
 * Restricted to writeRoles (super admin / admin / HR); the attendance_days
 * write policy enforces the identical rule underneath — this is the fast,
 * friendly rejection, not the security boundary.
 */
export async function correctAttendance(formData: FormData): Promise<CorrectionState> {
  // inputs
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
      error:
        'Enter both punch in and punch out, or leave both blank — a single punch would record zero hours.',
    };
  }
  if (!uuidRe.test(employeeId)) {
    return { ok: false, error: 'This row has no database id, so the correction cannot be saved.' };
  }
  if (!dateRe.test(workDate)) {
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
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: 'The database is not configured, so this correction cannot be saved.',
    };
  }

  // authorise
  const session = await getSession();
  if (!session.profile) {
    return { ok: false, error: 'Your session has expired. Sign in again to make corrections.' };
  }
  if (!writeRoles.includes(session.profile.role)) {
    return {
      ok: false,
      error: `Your account role "${session.profile.role}" cannot write attendance. Only ${writeRoles.join(
        ', ',
      )} may correct the register.`,
    };
  }

  const dbc = await createClient();

  // Name the employee in the audit message, and prove the id is real.
  const { data: employee, error: employeeError } = await dbc
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

  // Prevent corrections to months with locked/paid payroll runs or sealed attendance periods.
  const open = await requireOpenPayrollMonth(dbc, workDate);
  if (!open.ok) return open;

  // write
  const { data: saved, error: saveError } = await dbc
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
  // Verify row returned from upsert to confirm authorization policy permitted the mutation.
  if (!saved) {
    return {
      ok: false,
      error:
        'The correction was not saved — your role may not have permission to write attendance.',
    };
  }

  // comp-off availment
  // When manually recording a comp-off ('CO'), deduct oldest available credit (FIFO).
  // Non-fatal warning if deduction fails so the attendance correction itself is preserved.
  let compOffWarning: string | null = null;
  if (status === 'CO') {
    // Idempotence: re-saving the same day must not spend a second credit.
    const { data: already } = await dbc
      .from('comp_offs')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('used_date', workDate)
      .in('status', ['applied', 'used'])
      .limit(1);
    if (!already || already.length === 0) {
      let fifo = await dbc
        .from('comp_offs')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('status', 'available')
        .eq('is_applicable', true)
        .order('expires_on', { ascending: true, nullsFirst: false })
        .order('earned_date', { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (fifo.data?.id) {
        const { error: spendErr } = await dbc
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

  // audit log
  const punchText = punchIn && punchOut ? `${punchIn}–${punchOut}` : 'no punches';
  const actor = session.profile.full_name ?? session.email ?? 'A staff user';
  const { error: logError } = await dbc.from('activity_log').insert({
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

  // The attendance row is already committed — these are two separate writes
  // with no transaction around them. Surface the audit failure as a WARNING on a
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
 * Apply one attendance status to a batch with a required reason and one audit summary. Reject the
 * whole batch if any month is closed. Clear punches and worked minutes because this changes day
 * status, not punch times.
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
  if (!isAllowedStatus(status))
    return { ok: false, error: `Invalid status: ${status || '(missing)'}` };
  if (targets.length === 0) return { ok: false, error: 'Select at least one day to correct.' };
  if (targets.length > 2000)
    return { ok: false, error: 'Too many cells at once — narrow the selection.' };

  for (const t of targets) {
    if (!uuidRe.test(t.employeeId) || !dateRe.test(t.workDate)) {
      return { ok: false, error: 'One of the selected cells is invalid, so nothing was changed.' };
    }
  }

  const gate = await requireStaff('Bulk-correcting attendance');
  if (!gate.ok) return gate;

  const dbc = await createClient();

  // Reject the batch if any affected month is closed. Query each month once.
  const months = [...new Set(targets.map((t) => t.workDate.slice(0, 7)))];
  for (const month of months) {
    const open = await requireOpenPayrollMonth(dbc, `${month}-01`);
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

  const { data: saved, error: saveError } = await dbc
    .from('attendance_days')
    .upsert(rows, { onConflict: 'employee_id,work_date' })
    .select('id');
  if (saveError)
    return { ok: false, error: `Could not save the corrections: ${saveError.message}` };
  if (!saved || saved.length === 0) {
    return {
      ok: false,
      error: 'No rows were written — your role may not have permission to write attendance.',
    };
  }

  const { profile } = await getSession();
  const actor = profile?.full_name ?? 'A staff user';
  const { error: logError } = await dbc.from('activity_log').insert({
    actor_id: gate.profileId,
    employee_id: null,
    event_type: 'attendance_correction',
    message: `${actor} bulk-set ${saved.length} day(s) to ${status} — ${reason}`,
    metadata: { status, reason, count: saved.length, bulk: true },
  });
  revalidatePath('/register');
  if (logError) {
    return {
      ok: true,
      warning: `Corrections saved, but the audit-log entry failed: ${logError.message}`,
    };
  }
  return { ok: true };
}
