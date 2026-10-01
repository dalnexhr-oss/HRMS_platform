import assert from 'node:assert/strict';
import test from 'node:test';
import { payrollFixture } from './helpers/payroll-fixture.mjs';

test('payroll persists Decimal128 amounts inside the reserved transaction', async () => {
  const payroll = payrollFixture();
  const result = await payroll.computePayslip('employee', 'run');
  const document = payroll.writes[0].document;
  assert.equal(document.employee_id, 'employee');
  assert.equal(document.payroll_run_id, 'run');
  assert.equal(document.net_payable._bsontype, 'Decimal128');
  assert.equal(document.net_payable.toString(), '28200');
  assert.equal(result.net_payable, 2_820_000);
  assert.equal(document.status, 'draft');
});

test('recomputation applies adjustments without resetting an existing payslip status', async () => {
  const payroll = payrollFixture({
    existing: { _id: 'slip', status: 'generated' },
    adjustment: { advance_recovery: '1000', bonus: '100' },
  });
  const result = await payroll.computePayslip('employee', 'run');
  const write = payroll.writes[0];
  assert.deepEqual(write.filter, { _id: 'slip' });
  assert(!Object.hasOwn(write.update.$set, 'status'));
  assert.equal(result.net_payable, 2_730_000);
});

test('locked, paid, and missing payroll runs reject computation before any payslip writes', async () => {
  for (const status of ['locked', 'paid', null]) {
    const payroll = payrollFixture({ run: status ? { _id: 'run', status } : null });
    await assert.rejects(payroll.computePayslip('employee', 'run'), /locked, paid, or missing/);
    assert.deepEqual(payroll.writes, []);
  }
});

test('professional-tax slab precedence survives the calculation extraction', async () => {
  const payroll = payrollFixture({
    branch: { state: 'Maharashtra' },
    slabs: [
      { min_gross: '0', amount: '100' },
      { min_gross: '0', gender: 'male', amount: '150' },
      { min_gross: '0', month: 4, amount: '200' },
      { min_gross: '10000', month: 4, amount: '250' },
      { min_gross: '0', month: 2, amount: '300' },
    ],
  });
  const result = await payroll.computePayslip('employee', 'run');
  assert.equal(result.professional_tax, 25_000);
});
