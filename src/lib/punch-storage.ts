import 'server-only';
import { db, withTransaction } from '@/lib/db/mongo';
import { monthSealReason, periodMonthFor } from '@/lib/payroll-month';
import { localParts, dayFloorUtc, summarizePunches } from '@/lib/punch-day';
import { autoCloseDay, clockToMinutes, minutesToClock } from '@/lib/attendance-rules';
import type { ClientSession, Document } from 'mongodb';
import type { DayEvent } from '@/lib/punch-day';
import type { PayrollRunSeal } from '@/lib/payroll-month';

type StoredDoc = Document & { _id: string };

// A common write makes concurrent web/device/sweep transactions retry with fresh attendance.
async function lockEmployeePunches(employeeId: string, session?: ClientSession): Promise<void> {
  const result = await (
    await db()
  )
    .collection<StoredDoc>('employees')
    .updateOne({ _id: employeeId }, { $inc: { punch_revision: 1 } }, { session });
  if (!result.matchedCount) {
    throw new Error('Employee record no longer exists.');
  }
}

async function readDayEvents(
  employeeId: string,
  date: string,
  session?: ClientSession,
): Promise<DayEvent[]> {
  const ceiling = new Date(`${date}T00:00:00Z`);
  ceiling.setUTCDate(ceiling.getUTCDate() + 1);
  const events = await (
    await db()
  )
    .collection('punch_events')
    .find(
      { employee_id: employeeId, punched_at: { $gte: dayFloorUtc(date), $lt: ceiling } },
      { session },
    )
    .sort({ punched_at: 1, _id: 1 })
    .toArray();
  return events.filter(
    (row) => localParts(new Date(row.punched_at)).date === date,
  ) as unknown as DayEvent[];
}

async function punchWriteReason(
  employeeId: string,
  date: string,
  session?: ClientSession,
): Promise<string | null> {
  const database = await db();
  const employee = await database
    .collection<StoredDoc>('employees')
    .findOne({ _id: employeeId }, { session });
  if (!employee || employee.deleted_at || !['active', 'on_notice'].includes(employee.status)) {
    return 'This employee is not active for attendance.';
  }
  const periodMonth = periodMonthFor(date);
  const run = await database
    .collection<Document & PayrollRunSeal>('payroll_runs')
    .findOne({ period_month: periodMonth }, { session });
  const sealed = monthSealReason(periodMonth, run);
  if (sealed) {
    return sealed;
  }
  const day = await database
    .collection('attendance_days')
    .findOne({ employee_id: employeeId, work_date: date }, { session });
  if (day?.auto_close_source) {
    return 'This attendance day was closed by a night sweep. Ask HR to review the scan.';
  }
  if (day?.is_corrected) {
    return 'This attendance day was corrected by HR. Ask HR to review the scan.';
  }
  return null;
}

/** Caller must select authorized attendance IDs before calling this internal helper. */
async function closePunchDay(
  dayId: string,
  closeMin: number,
  source: 'manual' | 'scheduled',
  actorId: string | null,
): Promise<boolean> {
  const database = await db();
  return withTransaction(
    async (session) => {
      const attendance = database.collection<StoredDoc>('attendance_days');
      const initial = await attendance.findOne({ _id: dayId }, { session });
      if (!initial) {
        return false;
      }
      await lockEmployeePunches(initial.employee_id, session);
      const day = await attendance.findOne({ _id: dayId }, { session });
      if (!day || !day.punch_in || day.punch_out || day.is_corrected || day.auto_close_source) {
        return false;
      }
      const periodMonth = periodMonthFor(day.work_date);
      const run = await database
        .collection<Document & PayrollRunSeal>('payroll_runs')
        .findOne({ period_month: periodMonth }, { session });
      if (monthSealReason(periodMonth, run)) {
        return false;
      }
      const events = await readDayEvents(day.employee_id, day.work_date, session);
      const summary = summarizePunches(events);
      // Legacy/imported days have no raw events; retain the existing first-in fallback for them.
      const openIn = events.length ? summary.openIn : day.punch_in;
      const result = autoCloseDay(clockToMinutes(openIn), null, closeMin);
      if (!result) {
        return false;
      }
      const now = new Date();
      const updated = await attendance.updateOne(
        { _id: dayId, punch_out: null, updated_at: day.updated_at },
        {
          $set: {
            punch_out: minutesToClock(result.outMin),
            worked_minutes: summary.workedMinutes + result.workedMin,
            is_corrected: true,
            correction_reason:
              source === 'scheduled'
                ? 'Auto punch-out: no closing punch was recorded.'
                : 'Manual night sweep: no closing punch was recorded.',
            corrected_by: actorId,
            auto_close_source: source,
            auto_closed_at: now,
            updated_at: now,
          },
        },
        { session },
      );
      return updated.matchedCount === 1;
    },
    { required: true },
  );
}

export { 
  lockEmployeePunches,
  readDayEvents, 
  punchWriteReason, 
  closePunchDay 
};
