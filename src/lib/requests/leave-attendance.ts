// Called after the request action authorizes the caller. Follow-up writes use the
// same scoped client (or the narrowly authorized service client) supplied by that action.
import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { queryErrorCodes } from '@/lib/db/query-errors';
import { getWeekOffPolicy } from '@/lib/queries/settings';
import { getHolidays } from '@/lib/queries/holidays';
import { countLeaveDays, isScheduledWeekOff } from '@/lib/weekly-off-policy';

/** Inclusive whole-day count between two ISO dates ('16th'..'16th' === 1 day). */
function inclusiveDays(start: Date, end: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}

/**
 * Load holiday and week-off rules for countLeaveDays. Other request types use the calendar span. If
 * policy reads fail, leave requests also fall back to the calendar span.
 */
async function leaveDayCount(
  startISO: string,
  endISO: string,
  start: Date,
  end: Date,
): Promise<number> {
  try {
    const [policy, holidays, sandwich] = await Promise.all([
      getWeekOffPolicy(),
      getHolidays(),
      getSandwichPolicy(),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const days = countLeaveDays(startISO, endISO, { policy, holidays: holidaySet, sandwich });
    // A span of only non-working days costs nothing to take, but a zero-day
    // request is not a thing the rest of the system can reason about — reject it
    // in the caller rather than storing 0.
    return days;
  } catch {
    return inclusiveDays(start, end);
  }
}

/** The configurable sandwich-leave toggle, from the settings collection. */
async function getSandwichPolicy(): Promise<boolean> {
  try {
    const dbc = await createClient();
    const { data } = await dbc
      .from('settings')
      .select('value')
      .eq('key', 'leave_sandwich_policy')
      .maybeSingle<{ value: unknown }>();
    return data?.value === true || data?.value === 'true';
  } catch {
    return false;
  }
}

/** Every 'YYYY-MM-DD' in an inclusive span (small spans only — capped upstream). */
function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return out;
  }
  while (cursor.getTime() <= end.getTime() && out.length < 1000) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// Register stamps for approved off-site work. A site visit is Site; outdoor duty and work from
// home are Travel, matching the labels on the approvals screen.
const dutyStamps: Record<string, 'S' | 'T'> = { site_visit: 'S', outdoor_duty: 'T', wfh: 'T' };

/** Stamp approved leave as L. See stampApprovedDays for which days are written. */
function stampLeaveOnRegister(
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  startISO: string,
  endISO: string,
): Promise<string | null> {
  return stampApprovedDays(dbc, employeeId, startISO, endISO, { status: 'L' });
}

/**
 * Stamp an approved site visit, outdoor duty or work-from-home request as a worked day. The day is
 * credited a full day's minutes because no punch is expected; if the employee does punch, their
 * punches replace the credit.
 */
async function stampDutyOnRegister(
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  requestType: string,
  startISO: string,
  endISO: string,
): Promise<string | null> {
  const status = dutyStamps[requestType];
  if (!status) {
    return null;
  }
  let fullDayMinutes = 555;
  const { data } = await dbc
    .from('settings')
    .select('value')
    .eq('key', 'full_day_minutes')
    .maybeSingle<{ value: unknown }>();
  const configured = Number(data?.value);
  if (Number.isFinite(configured) && configured > 0) {
    fullDayMinutes = configured;
  }
  return stampApprovedDays(dbc, employeeId, startISO, endISO, {
    status,
    worked_minutes: fullDayMinutes,
  });
}

/**
 * Undo the stamps an approval made, when the request is cancelled afterwards. Only days that still
 * carry the approval's stamp and have no punches are removed, so a day the employee worked or HR
 * corrected is left as it is. Returns a note for the caller when a closed month was skipped.
 */
async function unstampApprovedDays(
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  requestType: string,
  startISO: string,
  endISO: string,
): Promise<string | null> {
  const status = requestType === 'leave' ? 'L' : dutyStamps[requestType];
  if (!status) {
    return null;
  }
  const skipped: string[] = [];
  for (const month of new Set(enumerateDays(startISO, endISO).map((day) => day.slice(0, 7)))) {
    const gate = await requireOpenPayrollMonthShim(dbc, `${month}-01`);
    if (!gate.ok) {
      skipped.push(month);
      continue;
    }
    const { error } = await dbc
      .from('attendance_days')
      .delete()
      .eq('employee_id', employeeId)
      .eq('status', status)
      .is('punch_in', null)
      .neq('is_corrected', true)
      .gte('work_date', startISO > `${month}-01` ? startISO : `${month}-01`)
      .lte('work_date', endISO < `${month}-31` ? endISO : `${month}-31`);
    if (error) {
      return `Cancelled, but the register could not be cleared: ${error.message}. Remove the ${status} day(s) from the register.`;
    }
  }
  return skipped.length > 0
    ? `Cancelled, but payroll for ${skipped.join(', ')} is closed, so those days stay on the register.`
    : null;
}

/**
 * Stamp approved days only where attendance is missing or AB. Preserve recorded presence and
 * existing off-day stamps, and skip unrecorded holidays and week-offs. Return locked-month skips as
 * warnings because the approval has already saved.
 */
async function stampApprovedDays(
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  startISO: string,
  endISO: string,
  stamp: { status: 'L' | 'S' | 'T'; worked_minutes?: number },
): Promise<string | null> {
  const days = enumerateDays(startISO, endISO);
  if (days.length === 0) {
    return null;
  }

  let policy: Awaited<ReturnType<typeof getWeekOffPolicy>>;
  let holidaySet: Set<string>;
  try {
    const [p, holidays] = await Promise.all([getWeekOffPolicy(), getHolidays()]);
    policy = p;
    holidaySet = new Set(holidays.map((h) => h.date));
  } catch (e) {
    return `Approved, but the register could not be stamped (week-off policy unreadable: ${
      e instanceof Error ? e.message : String(e)
    }). Mark the day(s) ${stamp.status} from the register.`;
  }

  const { data: existing, error: readErr } = await dbc
    .from('attendance_days')
    .select('work_date, status')
    .eq('employee_id', employeeId)
    .gte('work_date', days[0])
    .lte('work_date', days[days.length - 1]);
  if (readErr) {
    return `Approved, but the register could not be read to stamp the days: ${readErr.message}. Mark the day(s) ${stamp.status} from the register.`;
  }
  const statusByDate = new Map<string, string>();
  for (const row of (existing ?? []) as Array<{ work_date: string; status: string }>) {
    statusByDate.set(row.work_date, row.status);
  }

  // Check each involved month's payroll state once, not per day.
  const lockedMonths = new Set<string>();
  for (const month of new Set(days.map((d) => d.slice(0, 7)))) {
    const gate = await requireOpenPayrollMonthShim(dbc, `${month}-01`);
    if (!gate.ok) {
      lockedMonths.add(month);
    }
  }

  const toUpdate: string[] = []; // existing 'AB' rows
  const toInsert: string[] = []; // no row at all
  const skippedLocked: string[] = [];
  for (const day of days) {
    if (lockedMonths.has(day.slice(0, 7))) {
      skippedLocked.push(day);
      continue;
    }
    const status = statusByDate.get(day);
    if (status === 'AB') {
      toUpdate.push(day);
    } else if (status == null && !isScheduledWeekOff(day, policy) && !holidaySet.has(day)) {
      toInsert.push(day);
    }
  }

  const problems: string[] = [];
  if (toUpdate.length > 0) {
    const { error } = await dbc
      .from('attendance_days')
      .update(stamp)
      .eq('employee_id', employeeId)
      .eq('status', 'AB')
      .in('work_date', toUpdate);
    if (error) {
      problems.push(`could not restamp AB day(s): ${error.message}`);
    }
  }
  if (toInsert.length > 0) {
    const { error } = await dbc
      .from('attendance_days')
      .insert(
        toInsert.map((workDate) => ({ employee_id: employeeId, work_date: workDate, ...stamp })),
      );
    // Ignore duplicate key conflicts if stamped concurrently.
    if (error && error.code !== queryErrorCodes.duplicateKey) {
      problems.push(`could not add ${stamp.status} day(s): ${error.message}`);
    }
  }
  if (skippedLocked.length > 0) {
    problems.push(
      `payroll for ${[...lockedMonths].join(', ')} is closed, so ${skippedLocked.length} day(s) were not stamped`,
    );
  }
  return problems.length > 0
    ? `Approved, but the register was only partially stamped: ${problems.join('; ')}.`
    : null;
}

/** Local month gate — mirrors requireOpenPayrollMonth but never throws. */
async function requireOpenPayrollMonthShim(
  dbc: Awaited<ReturnType<typeof createClient>>,
  periodMonth: string,
): Promise<{ ok: boolean }> {
  const { data, error } = await dbc
    .from('payroll_runs')
    .select('status, month_closed_at')
    .eq('period_month', periodMonth)
    // month_closed_at is a BSON date; only its presence is tested below.
    .maybeSingle<{ status: string; month_closed_at: Date | null }>();
  if (error) {
    // fail closed — don't stamp a month we can't check
    return { ok: false };
  }
  if (data?.status === 'locked' || data?.status === 'paid') {
    return { ok: false };
  }
  if (data?.month_closed_at) {
    return { ok: false };
  }
  return { ok: true };
}

export {
  inclusiveDays,
  leaveDayCount,
  stampLeaveOnRegister,
  stampDutyOnRegister,
  unstampApprovedDays,
};
