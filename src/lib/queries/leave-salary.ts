import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail, isoOrNull, iso } from '@/lib/queries/shared';
import { presentCredit } from '@/lib/leave-salary';

// leave salary
// The /leave-salary page model: one paid-leave pool of 15 days plus
// an annual leave-salary working per employee. The old encashment/adjustment
// list queries died with the PL/CL/SL screen; the tables themselves remain.

interface LeaveBalanceAdminRow {
  employeeId: string;
  code: string;
  name: string;
  year: number;
  type: string;
  balance: number;
}

/** Every employee's PAID-LEAVE pool for a year — the pool card on /leave-salary. */
async function getLeaveBalancesForYear(year: number): Promise<LeaveBalanceAdminRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('leave_balances')
    .select('employee_id, year, type, balance, employees(code, full_name)')
    .eq('year', year)
    // One pool now. Historic CL/SL rows stay in the table but not on screen.
    .eq('type', 'PL');
  if (error) {
    fail('getLeaveBalancesForYear: could not load balances', error);
  }
  return (data ?? [])
    .map((r: any) => ({
      employeeId: r.employee_id,
      code: r.employees?.code ?? '',
      name: r.employees?.full_name ?? '',
      year: Number(r.year),
      type: r.type,
      balance: Number(r.balance ?? 0),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

interface LeaveSalaryWorkingRow {
  id: string;
  employeeId: string;
  year: number;
  salaryBefore: number;
  salaryAfter: number;
  /** 'YYYY-MM-01' — first day of the post-appraisal salary. */
  incrementEffective: string;
  presentP1: number;
  presentP2: number;
  calendarDaysP1: number;
  calendarDaysP2: number;
  amountP1: number;
  amountP2: number;
  totalAmount: number;
  status: 'draft' | 'finalized' | 'paid';
  remarks: string | null;
  paidAt: string | null;
  updatedAt: string;
  /** Calendar-day overrides entered by HR; null uses the actual calendar count. */
  calendarDaysP1Override: number | null;
  calendarDaysP2Override: number | null;
}

/**
 * Return saved leave-salary workings, or null when the collection is unavailable. An empty array
 * means no workings have been saved.
 */
async function getLeaveSalaryWorkings(year: number): Promise<LeaveSalaryWorkingRow[] | null> {
  const queryClient = await createClient();
  const res = await queryClient
    .from('leave_salary_workings')
    .select(
      `id, employee_id, year, salary_before, salary_after, increment_effective,
       present_p1, present_p2, calendar_days_p1, calendar_days_p2,
       amount_p1, amount_p2, total_amount, status, remarks, paid_at, updated_at,
       calendar_days_p1_override, calendar_days_p2_override`,
    )
    .eq('year', year);
  if (res.error) {
    fail('getLeaveSalaryWorkings: could not load workings', res.error);
  }
  return (res.data ?? []).map((r: any) => ({
    id: r.id,
    employeeId: r.employee_id,
    year: Number(r.year),
    salaryBefore: Number(r.salary_before ?? 0),
    salaryAfter: Number(r.salary_after ?? 0),
    incrementEffective: String(r.increment_effective).slice(0, 10),
    presentP1: Number(r.present_p1 ?? 0),
    presentP2: Number(r.present_p2 ?? 0),
    calendarDaysP1: Number(r.calendar_days_p1 ?? 0),
    calendarDaysP2: Number(r.calendar_days_p2 ?? 0),
    amountP1: Number(r.amount_p1 ?? 0),
    amountP2: Number(r.amount_p2 ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
    status: r.status,
    remarks: r.remarks,
    paidAt: isoOrNull(r.paid_at),
    updatedAt: iso(r.updated_at),
    calendarDaysP1Override:
      r.calendar_days_p1_override != null ? Number(r.calendar_days_p1_override) : null,
    calendarDaysP2Override:
      r.calendar_days_p2_override != null ? Number(r.calendar_days_p2_override) : null,
  }));
}

interface LeaveSalaryEmployee {
  id: string;
  code: string;
  name: string;
  grossMonthly: number;
  dateOfJoining: string | null;
  status: string;
}

/**
 * Who belongs on the year's leave-salary sheet: everyone still on the roster,
 * PLUS anyone off it who already has a saved working for the year — a mid-year
 * leaver's payout row must not vanish the day HR marks them inactive.
 */
async function getLeaveSalaryRoster(year: number): Promise<LeaveSalaryEmployee[]> {
  const queryClient = await createClient();

  const { data, error } = await queryClient
    .from('employees')
    .select('id, code, full_name, gross_monthly, date_of_joining, status')
    .in('status', ['active', 'on_notice'])
    .order('code');
  if (error) {
    fail('getLeaveSalaryRoster: could not load employees', error);
  }

  const rows = new Map<string, any>((data ?? []).map((e: any) => [e.id, e]));

  // Inactive employees with a saved working for this year still belong.
  const { data: saved, error: savedError } = await queryClient
    .from('leave_salary_workings')
    .select('employee_id, employees(id, code, full_name, gross_monthly, date_of_joining, status)')
    .eq('year', year);
  if (savedError) {
    fail('getLeaveSalaryRoster: could not load saved workings', savedError);
  }
  for (const r of (saved ?? []) as any[]) {
    if (r.employees && !rows.has(r.employees.id)) {
      rows.set(r.employees.id, r.employees);
    }
  }

  return [...rows.values()]
    .map((e: any) => ({
      id: e.id,
      code: e.code ?? '',
      name: e.full_name ?? '',
      grossMonthly: Number(e.gross_monthly ?? 0),
      dateOfJoining: e.date_of_joining ?? null,
      status: e.status ?? '',
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Aggregate annual presence across paged attendance rows. Use unique-key ordering so page
 * boundaries cannot repeat or omit attendance.
 */
async function getLeaveSalaryPresence(year: number): Promise<Record<string, number[]>> {
  const queryClient = await createClient();
  const pageSize = 1000;
  const byEmployee: Record<string, number[]> = {};

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryClient
      .from('attendance_days')
      .select('employee_id, work_date, status')
      .gte('work_date', `${year}-01-01`)
      .lte('work_date', `${year}-12-31`)
      .order('employee_id', { ascending: true })
      .order('work_date', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      fail('getLeaveSalaryPresence: could not load attendance', error);
    }

    const page = (data ?? []) as Array<{ employee_id: string; work_date: string; status: string }>;
    for (const r of page) {
      const months = (byEmployee[r.employee_id] ??= new Array(12).fill(0));
      const month = Number(String(r.work_date).slice(5, 7));
      if (month >= 1 && month <= 12) {
        months[month - 1] += presentCredit[r.status as keyof typeof presentCredit] ?? 0;
      }
    }
    if (page.length < pageSize) {
      break;
    }
  }
  return byEmployee;
}

export {
  getLeaveBalancesForYear,
  getLeaveSalaryWorkings,
  getLeaveSalaryRoster,
  getLeaveSalaryPresence,
};

export type { LeaveBalanceAdminRow, LeaveSalaryWorkingRow, LeaveSalaryEmployee };
