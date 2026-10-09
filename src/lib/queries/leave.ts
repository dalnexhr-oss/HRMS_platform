import 'server-only';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { todayISO } from '@/lib/business-dates';
import { toNumber } from '@/lib/db/decimal-conversions';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';
import type { LeaveType } from '@/types/database';

// leave balances
interface LeaveBalanceRow {
  type: LeaveType;
  balance: number;
}

/**
 * Retrieves an employee's active Paid Leave (PL) balance for the current calendar year.
 */
async function getLeaveBalances(employeeId: string): Promise<LeaveBalanceRow[]> {
  const balances = await scoped(collections.leaveBalances);
  const rows = await balances.find({
    employee_id: employeeId,
    year: Number(todayISO().slice(0, 4)),
    type: 'PL',
  });
  return rows.map((b) => ({ type: b.type as LeaveType, balance: toNumber(b.balance) }));
}

// on leave today
interface OnLeaveTodayRow {
  employeeId: string;
  name: string;
  branch: string;
  startDate: string;
  endDate: string;
}

/**
 * Return colleagues on approved leave today in IST through fn_on_leave_today.
 * Report query failures through the shared error handler.
 */
async function getOnLeaveToday(): Promise<OnLeaveTodayRow[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient.callFunction('fn_on_leave_today');
  // The database client registers this handler during initialization.
  if (error) {
    fail('getOnLeaveToday: could not load who is on leave', error);
  }
  return ((data ?? []) as any[]).map((r) => ({
    employeeId: r.employee_id,
    name: r.full_name ?? '',
    branch: r.branch ?? '',
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
  }));
}

export { getLeaveBalances, getOnLeaveToday };

export type { LeaveBalanceRow, OnLeaveTodayRow };
