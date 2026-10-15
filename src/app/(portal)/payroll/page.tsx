import './payroll.css';
import { PayrollScreen } from '@/components/payroll/PayrollScreen';
import {
  getPayrollRun,
  getPayslips,
  loadAdjustments,
  loadAdjustmentWindow,
} from '@/lib/queries/payroll';
import { currentPeriodMonth } from '@/lib/business-dates';

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;

function periodFromParam(m: string | undefined): string {
  return m && monthRe.test(m) ? `${m}-01` : currentPeriodMonth();
}

function shiftMonthParam(periodMonth: string, delta: number): string {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function PayrollPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const periodMonth = periodFromParam(m);
  const prev = shiftMonthParam(periodMonth, -1);
  const next = shiftMonthParam(periodMonth, 1);
  const [run, payslips] = await Promise.all([getPayrollRun(periodMonth), getPayslips(periodMonth)]);
  const [adjustments, adjWindow] = await Promise.all([
    loadAdjustments(payslips.map((p) => p.id)),
    loadAdjustmentWindow(run?.id ?? null),
  ]);
  return (
    <PayrollScreen
      run={run}
      payslips={payslips}
      periodMonth={periodMonth}
      prev={prev}
      next={next}
      adjustments={adjustments}
      adjWindow={adjWindow}
    />
  );
}

export { PayrollPage as default };
