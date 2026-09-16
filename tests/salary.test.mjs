import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateSalary } from '../src/lib/salary.ts';
import { parseMoneyPaise, formatPaise } from '../src/lib/money.ts';
import { fromPaise, toPaise } from '../src/lib/db/money.ts';
import { SalaryFields } from '../src/components/employees/SalaryFields.tsx';

const initial = { gross_monthly: '30,000', basic_da: '15,000', hra: '9,000' };

test('allowance follows changes to each salary input', () => {
  assert.equal(calculateSalary(initial).special, 600_000);
  assert.equal(calculateSalary({ ...initial, gross_monthly: '35000' }).special, 1_100_000);
  assert.equal(calculateSalary({ ...initial, basic_da: '16000' }).special, 500_000);
  assert.equal(calculateSalary({ ...initial, hra: '8000' }).special, 700_000);
  assert.equal(calculateSalary({ ...initial, hra: '' }).special, 1_500_000);
  assert.equal(calculateSalary({ ...initial, basic_da: '', hra: '' }).special, 3_000_000);
});

test('decimal calculation matches the stored Decimal128 components exactly', () => {
  for (const input of [
    { gross_monthly: '0.30', basic_da: '0.10', hra: '0.20' },
    { gross_monthly: '30000.015', basic_da: '15000.005', hra: '9000.004' },
    { gross_monthly: '₹ 1,23,456.78', basic_da: '50,000.25', hra: '20,000.10' },
  ]) {
    const result = calculateSalary(input);
    assert.equal(result.ok, true);
    assert.equal(result.gross, result.basic + result.hra + result.special);
    assert.equal(toPaise(fromPaise(result.special)), result.special);
    assert.equal(parseMoneyPaise(formatPaise(result.special).replaceAll(',', '')), result.special);
  }
  assert.equal(
    calculateSalary({ gross_monthly: '0.30', basic_da: '0.10', hra: '0.20' }).special,
    0,
  );
  assert.equal(
    calculateSalary({ gross_monthly: '30000.015', basic_da: '15000.005', hra: '9000.004' }).special,
    600_001,
  );
});

test('overallocated and invalid salaries show an error without hiding the negative balance', () => {
  const overallocated = calculateSalary({ ...initial, gross_monthly: '20000' });
  assert.equal(overallocated.ok, false);
  assert.equal(overallocated.special, -400_000);
  assert.match(overallocated.error, /exceed gross/);
  for (const input of [
    { ...initial, gross_monthly: '' },
    { ...initial, basic_da: '-1' },
    { ...initial, hra: '-1' },
    { ...initial, hra: 'abc' },
    { ...initial, hra: '12x3' },
    { ...initial, hra: '9..2' },
    { ...initial, hra: '.' },
    { ...initial, gross_monthly: '999999999999999999999999999' },
  ]) {
    assert.equal(calculateSalary(input).ok, false);
  }
  assert.equal(calculateSalary({ ...initial, hra: 'abc' }).special, null);
  assert.equal(calculateSalary({ ...initial, hra: '9000.' }).special, 600_000);
});

test('shared money parsing preserves database rounding and blank-value handling', () => {
  for (const [value, expected] of [
    [null, 0],
    ['', 0],
    ['0.005', 1],
    ['-0.005', -1],
    ['1.999', 200],
    [fromPaise(12_345), 12_345],
    [10.25, 1025],
  ]) {
    assert.equal(toPaise(value), expected);
  }
  assert.throws(() => toPaise('not a number'), TypeError);
});

test('add and edit salary forms derive their initial allowance from the editable fields', () => {
  const added = renderToStaticMarkup(createElement(SalaryFields));
  const edited = renderToStaticMarkup(
    createElement(SalaryFields, {
      initial: { gross_monthly: 42_000.75, basic_da: 20_000.25, hra: 10_000.1 },
    }),
  );
  const allowance = added.match(/<input\b[^>]*name="special_allowance"[^>]*>/)?.[0];
  assert.ok(allowance);
  assert.match(allowance, /readOnly=""/);
  assert.match(allowance, /value="6,000\.00"/);
  assert.match(edited, /name="special_allowance"[^>]*value="12,000.40"/);
  const zero = renderToStaticMarkup(
    createElement(SalaryFields, {
      initial: { gross_monthly: 100, basic_da: 0, hra: 0 },
    }),
  );
  assert.match(zero, /name="special_allowance"[^>]*value="100.00"/);
});
