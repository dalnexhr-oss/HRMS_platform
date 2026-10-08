import 'server-only';
import { currentPeriodMonth, monthRange } from '@/lib/business-dates';
import { createClient } from '@/lib/db/server-client';
import { fail, isoOrNull } from '@/lib/queries/shared';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import type { PayslipRow } from '@/types/domain';

// Projection fields for payslip queries, embedding related adjustments.
const payslipFields = `id, payable_days, earned_gross, shortfall_amount, per_day_rate,
  basic_earned, hra_earned, special_earned, pf_employee, pf_employer, esic_employee,
  esic_employer, professional_tax, net_payable, shortfall_minutes, payslip_adjustments(*)`;

function mapPayslip(p: any): PayslipRow {
  // The 1:1 embed's shape (object vs single-element array) depends on how the
  // relationship is declared — accept both, and null when no row exists.
  const adj = Array.isArray(p.payslip_adjustments)
    ? p.payslip_adjustments[0]
    : p.payslip_adjustments;
  return {
    // Payslip record UUID (distinguished from employee code for unique React keys and adjustment lookups).
    id: p.id,
    code: p.employees?.code ?? '',
    name: p.employees?.full_name ?? '',
    branch: p.employees?.branches?.name ?? '',
    state: p.employees?.branches?.state,
    periodMonth: p.payroll_runs?.period_month ?? null,
    payableDays: Number(p.payable_days),
    earnedGross: Number(p.earned_gross),
    shortfallAmount: Number(p.shortfall_amount),
    perDayRate: Number(p.per_day_rate),
    basicEarned: Number(p.basic_earned),
    hraEarned: Number(p.hra_earned),
    specialEarned: Number(p.special_earned),
    pfEmployee: Number(p.pf_employee),
    pfEmployer: Number(p.pf_employer),
    esicEmployee: Number(p.esic_employee),
    esicEmployer: Number(p.esic_employer),
    professionalTax: Number(p.professional_tax),
    netPayable: Number(p.net_payable),
    shortfallMinutes: p.shortfall_minutes,
    advanceRecovery: Number(adj?.advance_recovery ?? 0),
    lossDamage: Number(adj?.loss_damage ?? 0),
    otherDeductions: Number(adj?.other_deductions ?? 0),
    lastMonthBalance: Number(adj?.last_month_balance ?? 0),
    reimbursementBonus: Number(adj?.reimbursement_bonus ?? 0),
    bonus: Number(adj?.bonus ?? 0),
  };
}

// payroll
async function getPayslips(periodMonth: string = currentPeriodMonth()): Promise<PayslipRow[]> {
  const { start } = monthRange(periodMonth);
  const dbc = await createClient();

  const { data: run, error: runError } = await dbc
    .from('payroll_runs')
    .select('id')
    .eq('period_month', start)
    .maybeSingle();
  if (runError) {
    fail('getPayslips: could not load the payroll run', runError);
  }
  if (!run) {
    // no run for this month yet — a real empty state
    return [];
  }

  const { data, error } = await dbc
    .from('payslips')
    .select(`${payslipFields}, employees(code, full_name, branches(name, state))`)
    .eq('payroll_run_id', run.id);
  if (error) {
    fail('getPayslips: could not load payslips', error);
  }

  return (
    (data ?? [])
      .map(mapPayslip)
      // The select filters by run.id rather than joining payroll_runs, so stamp the
      // known period month here so each row is labelled by month.
      .map((r) => ({ ...r, periodMonth: start }))
      .sort((a, b) => a.code.localeCompare(b.code))
  );
}

// payroll runs
interface PayrollRunView {
  id: string;
  periodMonth: string;
  status: 'draft' | 'in_review' | 'locked' | 'paid';
  workingDays: number | null;
  targetMinutes: number | null;
  monthClosedAt: string | null;
  draftsComputedAt: string | null;
  lockedAt: string | null;
  paidAt: string | null;
}

function mapRun(r: any): PayrollRunView {
  return {
    id: r._id ?? r.id,
    periodMonth: r.period_month,
    status: r.status,
    workingDays: r.working_days,
    targetMinutes: r.target_minutes,
    monthClosedAt: isoOrNull(r.month_closed_at),
    draftsComputedAt: isoOrNull(r.drafts_computed_at),
    lockedAt: isoOrNull(r.locked_at),
    paidAt: isoOrNull(r.paid_at),
  };
}

/** Every payroll run, newest month first. */
async function getPayrollRuns(): Promise<PayrollRunView[]> {
  const runs = await scoped(collections.payrollRuns);
  const rows = await runs.find({}, { sort: { period_month: -1 } });
  return rows.map(mapRun);
}

/** A single run by month, or null when that month has no run yet. */
async function getPayrollRun(periodMonth: string): Promise<PayrollRunView | null> {
  const { start } = monthRange(periodMonth);
  const runs = await scoped(collections.payrollRuns);
  const row = await runs.findOne({ period_month: start });
  return row ? mapRun(row) : null;
}

/**
 * One employee's final payslips, newest month first. Drafts are left out: their figures still
 * change until the run is locked, and a downloaded draft looks like a final payslip.
 */
async function getMyPayslips(employeeId: string): Promise<PayslipRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('payslips')
    .select(
      `${payslipFields}, payroll_runs(period_month),
       employees(code, full_name, branches(name, state))`,
    )
    .eq('employee_id', employeeId)
    .in('status', ['generated', 'paid']);
  if (error) {
    fail('getMyPayslips: could not load payslips', error);
  }

  return (data ?? [])
    .sort((a: any, b: any) =>
      String(b.payroll_runs?.period_month ?? '').localeCompare(
        String(a.payroll_runs?.period_month ?? ''),
      ),
    )
    .map(mapPayslip);
}

export { getPayslips, getPayrollRuns, getPayrollRun, getMyPayslips };

export type { PayrollRunView };
