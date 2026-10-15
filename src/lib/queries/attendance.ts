import 'server-only';
import { currentPeriodMonth, monthRange } from '@/lib/business-dates';
import { createClient } from '@/lib/db/server-client';
import { fail, iso } from '@/lib/queries/shared';
import { trimTime, minutesToHHMM, todayIST } from '@/lib/display-formatting';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { attendancePaySummary, resolvePayableAttendance } from '@/lib/attendance-pay';
import { policyFromSettings } from '@/lib/weekly-off-policy';
import type { RegisterEmployee, DayCell } from '@/types/domain';
import type { UserDoc, EmployeeDoc } from '@/lib/db/collection-registry';

// register
async function getRegister(
  periodMonth: string = currentPeriodMonth(),
  branch?: string | null,
): Promise<RegisterEmployee[]> {
  const { start, end } = monthRange(periodMonth);
  const queryClient = await createClient();

  // Branch scoping: resolve the branch name to its id and filter on the FK, so
  // employees are actually excluded (filtering on an embedded column would only
  // null the join, not drop the parent row). Blank/absent branch = all branches.
  let branchId: string | null = null;
  if (branch) {
    const { data: b } = await queryClient
      .from('branches')
      .select('id')
      .eq('name', branch)
      .maybeSingle<{ id: string }>();
    // Unknown branch name → no matches rather than silently showing everyone.
    branchId = b?.id ?? '__none__';
  }

  let employeeQuery = queryClient
    .from('employees')
    .select(
      'id, code, full_name, gender, date_of_joining, last_working_day, branch_id, status, branches(name)',
    )
    .order('code');
  if (branchId) {
    employeeQuery = employeeQuery.eq('branch_id', branchId);
  }

  const { data: employees, error } = await employeeQuery;
  if (error) {
    fail('getRegister: could not load employees', error);
  }
  if (!employees?.length) {
    return [];
  }

  const { data: days, error: daysError } = await queryClient
    .from('attendance_days')
    .select('employee_id, work_date, status, punch_in, punch_out, worked_minutes')
    .gte('work_date', start)
    .lte('work_date', end)
    .order('updated_at')
    .order('id');
  if (daysError) {
    fail('getRegister: could not load attendance', daysError);
  }

  const { data: settingRows, error: settingsError } = await queryClient
    .from('settings')
    .select('key, value')
    .in('key', ['full_day_minutes', 'week_off_weekdays', 'working_saturdays']);
  if (settingsError) {
    fail('getRegister: could not load pay rules', settingsError);
  }
  const settings = new Map((settingRows ?? []).map((row) => [String(row.key), row.value]));
  const configuredFullDay = Number(settings.get('full_day_minutes'));
  const fullDayMinutes =
    Number.isFinite(configuredFullDay) && configuredFullDay > 0 ? configuredFullDay : 555;
  const { data: holidays, error: holidayError } = await queryClient
    .from('holidays')
    .select('holiday_date, branch_id')
    .gte('holiday_date', start)
    .lte('holiday_date', end);
  if (holidayError) {
    fail('getRegister: could not load holidays', holidayError);
  }
  const calendar = {
    policy: policyFromSettings(
      settings.get('week_off_weekdays'),
      settings.get('working_saturdays'),
    ),
    holidays: (holidays ?? []).map((holiday) => ({
      date: String(holiday.holiday_date),
      branchId: holiday.branch_id as string | null,
    })),
  };

  const byEmployee = new Map<string, any[]>();
  for (const d of days ?? []) {
    const list = byEmployee.get((d as any).employee_id);
    if (list) {
      list.push(d);
    } else {
      byEmployee.set((d as any).employee_id, [d]);
    }
  }

  return employees
    .filter((employee) => {
      const joined = String(employee.date_of_joining ?? '').slice(0, 10);
      const left = employee.last_working_day
        ? String(employee.last_working_day).slice(0, 10)
        : null;
      return joined <= end && (byEmployee.has(employee.id) || !left || left >= start);
    })
    .map((e: any) => {
      const resolved = resolvePayableAttendance(
        periodMonth,
        (byEmployee.get(e.id) ?? []).map((day) => ({
          workDate: String(day.work_date),
          status: String(day.status),
          workedMinutes: Number(day.worked_minutes ?? 0),
        })),
        {
          branchId: e.branch_id ?? null,
          dateOfJoining: e.date_of_joining ?? null,
          lastWorkingDay: e.last_working_day ?? null,
        },
        calendar,
        todayIST(),
      );
      const rows = resolved.map((day) => {
        const original = (byEmployee.get(e.id) ?? [])
          .filter((row) => row.work_date === day.workDate)
          .at(-1);
        return {
          ...original,
          work_date: day.workDate,
          status: day.status,
          worked_minutes: day.workedMinutes,
        };
      });
      const cells: DayCell[] = rows.map((d: any) => ({
        day: Number(d.work_date.slice(8, 10)),
        status: d.status,
        in: trimTime(d.punch_in),
        out: trimTime(d.punch_out),
        hours: d.worked_minutes ? minutesToHHMM(d.worked_minutes) : null,
        // Week-offs come from the resolved status, not a hardcoded calendar.
        isWeekOff: d.status === 'WO',
      }));
      const { workingDays: working, payableDays, workedMinutes } = attendancePaySummary(resolved);
      const count = (s: string) => rows.filter((d: any) => d.status === s).length;
      return {
        id: e.id,
        code: e.code,
        name: e.full_name,
        branch: e.branches?.name ?? '',
        gender: e.gender,
        doj: e.date_of_joining,
        summary: {
          P: count('P'),
          LM: count('LM'),
          HD: count('HD'),
          L: count('L'),
          WO: count('WO'),
          working,
          payable: payableDays,
        },
        workedMinutes,
        targetMinutes: Math.round(working * fullDayMinutes),
        days: cells,
      };
    });
}

// register reconciliation
interface LeaveRegisterMismatch {
  employeeId: string;
  code: string;
  name: string;
  /** 'YYYY-MM-DD' of the approved-leave day the register does not reflect. */
  date: string;
  leaveKind: string | null;
  /** What the register shows instead of 'L' — 'AB', another code, or null (no row). */
  registerStatus: string | null;
}

/** Expand an inclusive ISO date span into 'YYYY-MM-DD' strings, clamped to a window. */
function isoDaysInRange(
  start: string,
  end: string,
  clampStart: string,
  clampEnd: string,
): string[] {
  const from = start < clampStart ? clampStart : start;
  const to = end > clampEnd ? clampEnd : end;
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= last.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Find approved leave days still missing from the register or marked AB. Preserve existing leave,
 * off-day, and presence stamps. This query reports gaps without changing attendance.
 */
async function getLeaveRegisterMismatches(
  periodMonth: string = currentPeriodMonth(),
  branch?: string | null,
): Promise<LeaveRegisterMismatch[]> {
  const { start, end } = monthRange(periodMonth);
  const queryClient = await createClient();

  // Approved leave requests overlapping the month.
  const { data: reqs, error: reqErr } = await queryClient
    .from('requests')
    .select(
      'employee_id, leave_kind, start_date, end_date, employees(code, full_name, branch_id, branches(name))',
    )
    .eq('type', 'leave')
    .eq('status', 'approved')
    .lte('start_date', end)
    .gte('end_date', start);
  if (reqErr) {
    fail('getLeaveRegisterMismatches: could not load approved leave', reqErr);
  }
  if (!reqs?.length) {
    return [];
  }

  // Register rows for the month, keyed employee|date.
  const { data: days, error: dayErr } = await queryClient
    .from('attendance_days')
    .select('employee_id, work_date, status')
    .gte('work_date', start)
    .lte('work_date', end);
  if (dayErr) {
    fail('getLeaveRegisterMismatches: could not load attendance', dayErr);
  }

  const byKey = new Map<string, string>();
  for (const d of days ?? []) {
    byKey.set(`${(d as any).employee_id}|${(d as any).work_date}`, (d as any).status);
  }

  // Statuses that already account for the day — not a divergence.
  const covered = new Set(['L', 'WO', 'OH', 'CO']);

  const out: LeaveRegisterMismatch[] = [];
  for (const r of reqs as any[]) {
    if (branch && r.employees?.branches?.name !== branch) {
      continue;
    }
    for (const date of isoDaysInRange(r.start_date, r.end_date, start, end)) {
      const status = byKey.get(`${r.employee_id}|${date}`) ?? null;
      if (status && covered.has(status)) {
        continue;
      }
      out.push({
        employeeId: r.employee_id,
        code: r.employees?.code ?? '',
        name: r.employees?.full_name ?? '',
        date,
        leaveKind: r.leave_kind ?? null,
        registerStatus: status,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  return out;
}

// attendance audit
interface AuditEntry {
  id: string;
  eventType: string;
  message: string;
  actor: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  occurredAt: string;
}

/** Attendance-related audit trail (corrections, imports, night sweeps), newest
 *  first. Reads activity_log; messages are rendered as TEXT only (stored-XSS
 *  safe). Staff-gated by the activity_log read policy. */
async function getAttendanceAudit(limit = 200): Promise<AuditEntry[]> {
  const log = await scoped(collections.activityLog);
  const rows = await log.find(
    { event_type: { $in: ['attendance_correction', 'register_import', 'night_sweep'] } },
    { sort: { occurred_at: -1 }, limit },
  );
  if (rows.length === 0) {
    return [];
  }

  // Resolve actor and employee names in batched lookups so older audit entries without cached names
  // remain readable.
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const employeeIds = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))] as string[];

  const [actors, employees] = await Promise.all([
    actorIds.length
      ? (await scoped<UserDoc>(collections.users)).find(
          { _id: { $in: actorIds } },
          { projection: { full_name: 1, email: 1 } },
        )
      : Promise.resolve([]),
    employeeIds.length
      ? (await scoped<EmployeeDoc>(collections.employees)).find(
          { _id: { $in: employeeIds } },
          { projection: { full_name: 1, code: 1 } },
        )
      : Promise.resolve([]),
  ]);

  const actorById = new Map(actors.map((a) => [a._id, a.full_name ?? a.email ?? null]));
  const employeeById = new Map(
    employees.map((e) => [e._id, { name: e.full_name ?? null, code: e.code ?? null }]),
  );

  return rows.map((r) => {
    const employee = r.employee_id ? employeeById.get(r.employee_id as string) : undefined;
    return {
      id: r._id as string,
      eventType: r.event_type as string,
      message: r.message as string,
      // A row written before this, or by a deleted account, still falls back to
      // whatever was denormalised at the time rather than showing nothing.
      actor: actorById.get(r.actor_id as string) ?? (r.actor_name as string | null) ?? null,
      employeeCode: employee?.code ?? (r.employee_code as string | null) ?? null,
      employeeName: employee?.name ?? (r.employee_name as string | null) ?? null,
      occurredAt: iso(r.occurred_at),
    };
  });
}

// employee self-service

/** One employee's day strip for a month. */
async function getMyAttendance(
  employeeId: string,
  periodMonth: string = currentPeriodMonth(),
): Promise<DayCell[]> {
  const { start, end } = monthRange(periodMonth);
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('attendance_days')
    .select('work_date, status, punch_in, punch_out, worked_minutes')
    .eq('employee_id', employeeId)
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date');
  if (error) {
    fail('getMyAttendance: could not load attendance', error);
  }

  return (data ?? []).map((d: any) => ({
    day: Number(d.work_date.slice(8, 10)),
    status: d.status,
    in: trimTime(d.punch_in),
    out: trimTime(d.punch_out),
    hours: d.worked_minutes ? minutesToHHMM(d.worked_minutes) : null,
    isWeekOff: d.status === 'WO',
  }));
}

export { getRegister, getLeaveRegisterMismatches, getAttendanceAudit, getMyAttendance };

export type { LeaveRegisterMismatch, AuditEntry };
