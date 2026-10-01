import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { calculatePayslip } = loadTypeScript('src/lib/payroll/payslip-calculation.ts');
const { scalePaiseAmount, roundToRupee } = loadTypeScript('src/lib/currency-conversion.ts');
function input(overrides = {}) {
  return {
    periodMonth: '2026-04-01',
    grossPaise: 3_000_000,
    basicPaise: 1_500_000,
    hraPaise: 900_000,
    specialAllowancePaise: 600_000,
    fullDayMinutes: 555,
    esicCapPaise: 2_100_000,
    professionalTaxPaise: 20_000,
    attendance: Array.from({ length: 30 }, () => ({ status: 'P', workedMinutes: 555 })),
    advancePaise: 0,
    lossPaise: 0,
    otherDeductionsPaise: 0,
    lastMonthBalancePaise: 0,
    reimbursementPaise: 0,
    bonusPaise: 0,
    ...overrides,
  };
}

test('full attendance preserves earnings, employee/employer PF, and net pay', () => {
  const result = calculatePayslip(input());
  assert.equal(result.payable_days, 30);
  assert.equal(result.earned_gross, 3_000_000);
  assert.equal(result.target_minutes, 16_650);
  assert.equal(result.shortfall_amount, 0);
  assert.equal(result.pf_employee, 180_000);
  assert.equal(result.pf_employer, 180_000);
  assert.equal(result.esic_employee, 0);
  assert.equal(result.net_payable, 2_800_000);
});

test('paid time off increases pay without adding required working minutes', () => {
  const result = calculatePayslip(
    input({
      attendance: [
        ...['P', 'T', 'S', 'LM'].map((status) => ({ status, workedMinutes: 555 })),
        { status: 'HD', workedMinutes: 278 },
        ...['CO', 'OH', 'WO', 'AB', 'L'].map((status) => ({ status, workedMinutes: 0 })),
      ],
    }),
  );
  assert.equal(result.payable_days, 7.5);
  assert.equal(result.target_minutes, 2498);
  assert.equal(result.earned_gross, 750_000);
  assert.equal(result.shortfall_amount, 0);
});

test('shortfalls floor deductions to whole rupees and full-day settings retain the fallback', () => {
  const attendance = [{ status: 'P', workedMinutes: 554 }];
  const result = calculatePayslip(input({ attendance }));
  assert.equal(result.shortfall_minutes, 1);
  assert.equal(result.shortfall_amount, 100);
  assert.deepEqual(calculatePayslip(input({ attendance, fullDayMinutes: 0 })), result);
});

test('ESIC eligibility uses monthly gross, including the exact cap', () => {
  const atCap = input({
    grossPaise: 2_100_000,
    basicPaise: 1_000_000,
    hraPaise: 600_000,
    specialAllowancePaise: 500_000,
  });
  assert.equal(calculatePayslip(atCap).esic_employee, 15_800);
  assert.equal(calculatePayslip(atCap).esic_employer, 68_300);
  assert.equal(calculatePayslip({ ...atCap, grossPaise: 2_100_001 }).esic_employee, 0);
});

test('adjustment signs and negative half-rupee rounding are preserved', () => {
  const result = calculatePayslip(
    input({
      attendance: [],
      professionalTaxPaise: 0,
      advancePaise: 300,
      lossPaise: 200,
      otherDeductionsPaise: 100,
      lastMonthBalancePaise: 100,
      reimbursementPaise: 200,
      bonusPaise: 50,
    }),
  );
  assert.equal(result.net_payable, -300);
  assert.equal(roundToRupee(250), 300);
  assert.equal(roundToRupee(-250), -300);
  assert.equal(scalePaiseAmount(-101, 0.5), -51);
});

test('leap-year payroll uses the correct calendar denominator', () => {
  const result = calculatePayslip(
    input({
      periodMonth: '2024-02-01',
      grossPaise: 2_900_000,
      basicPaise: 2_900_000,
      hraPaise: 0,
      specialAllowancePaise: 0,
      attendance: [{ status: 'P', workedMinutes: 555 }],
    }),
  );
  assert.equal(result.per_day_rate, 100_000);
  assert.equal(result.earned_gross, 100_000);
});
