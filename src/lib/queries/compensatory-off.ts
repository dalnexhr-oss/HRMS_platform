import 'server-only';
import { currentPeriodMonth, monthRange } from '@/lib/business-dates';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';

// comp offs
interface CompOffRow {
  id: string;
  employeeId: string;
  earnedDate: string;
  status: 'available' | 'applied' | 'used' | 'expired';
  usedDate: string | null;
  /** 0041: false = on hold by staff, an employee cannot apply against it. */
  isApplicable: boolean;
  expiresOn: string | null;
}

// expires_on and is_applicable may be missing on an older database; both
// selects retry without them and fall back to a default.
const compOffFields = 'id, employee_id, earned_date, status, used_date, expires_on, is_applicable';

function mapCompOff(c: any): CompOffRow {
  return {
    id: c.id,
    employeeId: c.employee_id,
    earnedDate: String(c.earned_date).slice(0, 10),
    status: c.status,
    usedDate: c.used_date ? String(c.used_date).slice(0, 10) : null,
    isApplicable: c.is_applicable !== false,
    expiresOn: c.expires_on ? String(c.expires_on).slice(0, 10) : null,
  };
}

/**
 * Comp-off credits already granted for a month, so the register can tell an
 * un-granted eligible day from one that has already been credited.
 * Keyed by `${employeeId}|${earnedDate}` at the callsite.
 */
async function getCompOffsForMonth(
  periodMonth: string = currentPeriodMonth(),
): Promise<CompOffRow[]> {
  const { start, end } = monthRange(periodMonth);
  const queryClient = await createClient();
  const res = await queryClient
    .from('comp_offs')
    .select(compOffFields)
    .gte('earned_date', start)
    .lte('earned_date', end);
  if (res.error) {
    fail('getCompOffsForMonth: could not load comp offs', res.error);
  }
  return (res.data ?? []).map(mapCompOff);
}

/** One employee's comp-off credits, newest earned first. */
async function getMyCompOffs(employeeId: string): Promise<CompOffRow[]> {
  const queryClient = await createClient();
  const res = await queryClient
    .from('comp_offs')
    .select(compOffFields)
    .eq('employee_id', employeeId)
    .order('earned_date', { ascending: false });
  if (res.error) {
    fail('getMyCompOffs: could not load comp offs', res.error);
  }
  return (res.data ?? []).map(mapCompOff);
}

/** A live (not yet spent/expired) credit with its owner, for the admin card. */
interface CompOffAdminRow extends CompOffRow {
  code: string;
  name: string;
}

/**
 * Every live comp-off credit (available or awaiting approval) with its owner —
 * the admin dashboard's comp-off card: per-employee balances plus the
 * applicable/not-applicable switch per credit.
 */
async function getCompOffAdmin(): Promise<CompOffAdminRow[]> {
  const queryClient = await createClient();
  const fields = (cols: string) => `${cols}, employees(code, full_name)`;
  const res = await queryClient
    .from('comp_offs')
    .select(fields(compOffFields))
    .in('status', ['available', 'applied'])
    .order('earned_date', { ascending: true });
  if (res.error) {
    fail('getCompOffAdmin: could not load comp offs', res.error);
  }
  return (res.data ?? [])
    .map((c: any) => ({
      ...mapCompOff(c),
      code: c.employees?.code ?? '',
      name: c.employees?.full_name ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.earnedDate.localeCompare(b.earnedDate));
}

export { getCompOffsForMonth, getMyCompOffs, getCompOffAdmin };

export type { CompOffRow, CompOffAdminRow };
