import 'server-only';
import { currentPeriodMonth, monthRange } from '@/lib/business-dates';
import { createClient } from '@/lib/db/server-client';
import { fail, iso } from '@/lib/queries/shared';
import { trimTime, minutesToHHMM } from '@/lib/display-formatting';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import type { RegisterEmployee, DayCell } from '@/types/domain';
import type { UserDoc, EmployeeDoc } from '@/lib/db/collection-registry';

// register
async function getRegister(
  periodMonth: string = currentPeriodMonth(),
  branch?: string | null,
): Promise<RegisterEmployee[]> {
  const { start, end } = monthRange(periodMonth);
  const dbc = await createClient();

  // Branch scoping: resolve the branch name to its id and filter on the FK, so
  // employees are actually excluded (filtering on an embedded column would only
  // null the join, not drop the parent row). Blank/absent branch = all branches.
  let branchId: string | null = null;
  if (branch) {
    const { data: b } = await dbc
      .from('branches')
      .select('id')
      .eq('name', branch)
      .maybeSingle<{ id: string }>();
    // Unknown branch name → no matches rather than silently showing everyone.
    branchId = b?.id ?? '__none__';
  }

  let employeeQuery = dbc
    .from('employees')
    .select('id, code, full_name, gender, date_of_joining, branches(name)')
    // Someone serving notice still punches and is still paid.
    .in('status', ['active', 'on_notice'])
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

  const { data: days, error: daysError } = await dbc
    .from('attendance_days')
    .select('employee_id, work_date, status, punch_in, punch_out, worked_minutes')
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date');
  if (daysError) {
    fail('getRegister: could not load attendance', daysError);
  }

  // Target hours use the payslip rule: each worked day owes one full day's minutes.
  const { data: fullDaySetting } = await dbc
    .from('settings')
    .select('value')
    .eq('key', 'full_day_minutes')
    .maybeSingle<{ value: unknown }>();
  const configuredFullDay = Number(fullDaySetting?.value);
  const fullDayMinutes =
    Number.isFinite(configuredFullDay) && configuredFullDay > 0 ? configuredFullDay : 555;

  const byEmployee = new Map<string, any[]>();
  for (const d of days ?? []) {
    const list = byEmployee.get((d as any).employee_id);
    if (list) {
      list.push(d);
    } else {
      byEmployee.set((d as any).employee_id, [d]);
    }
  }

  return employees.map((e: any) => {
    const rows = byEmployee.get(e.id) ?? [];
    const cells: DayCell[] = rows.map((d: any) => ({
      day: Number(d.work_date.slice(8, 10)),
      status: d.status,
      in: trimTime(d.punch_in),
      out: trimTime(d.punch_out),
      hours: d.worked_minutes ? minutesToHHMM(d.worked_minutes) : null,
      // Week-offs come from the resolved status, not a hardcoded calendar.
      isWeekOff: d.status === 'WO',
    }));
    const workedMinutes = rows.reduce((a: number, d: any) => a + (d.worked_minutes ?? 0), 0);
    const count = (s: string) => rows.filter((d: any) => d.status === s).length;
    // Mirrors v_monthly_attendance_summary / fn_compute_payslip: field days (S/T)
    // count as worked, half-days as 0.5, and paid leave is payable but not worked.
    const working = count('P') + count('LM') + count('S') + count('T') + 0.5 * count('HD');
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
        payable: working + count('L'),
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
  const dbc = await createClient();

  // Approved leave requests overlapping the month.
  const { data: reqs, error: reqErr } = await dbc
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
  const { data: days, error: dayErr } = await dbc
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
  const dbc = await createClient();
  const { data, error } = await dbc
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
