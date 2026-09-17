import assert from 'node:assert/strict';
import test from 'node:test';
import { presentDaySurplus } from '../src/lib/worked-time.ts';

function day(workedMinutes, dayOfMonth = 1, status = 'P') {
  return {
    work_date: `2026-09-${String(dayOfMonth).padStart(2, '0')}`,
    status,
    worked_minutes: workedMinutes,
  };
}

test('ten present days at 9h 17m show twenty surplus minutes', () => {
  const days = Array.from({ length: 10 }, (_, index) => day(557, index + 1));
  assert.deepEqual(presentDaySurplus(days, '2026-09-01', '2026-09-10'), {
    presentDays: 10,
    surplusMinutes: 20,
  });
});

test('exactly 9h 15m, short days, and no attendance never show a negative surplus', () => {
  for (const days of [[], [day(555)], [day(554)], [day(null)]]) {
    assert.equal(presentDaySurplus(days, '2026-09-01', '2026-09-10').surplusMinutes, 0);
  }
});

test('surplus compares total present-day minutes against the total present-day target', () => {
  assert.deepEqual(presentDaySurplus([day(560), day(552, 2)], '2026-09-01', '2026-09-10'), {
    presentDays: 2,
    surplusMinutes: 2,
  });
});

test('late, site, and travel attendance count as present; leave, half-days, and off days do not', () => {
  const days = ['P', 'LM', 'S', 'T', 'L', 'HD', 'WO', 'CO', 'OH', 'AB'].map((status, index) =>
    day(557, index + 1, status),
  );
  assert.deepEqual(presentDaySurplus(days, '2026-09-01', '2026-09-10'), {
    presentDays: 4,
    surplusMinutes: 8,
  });
});

test('only the selected month through the current IST day contributes', () => {
  const days = [
    { ...day(600), work_date: '2026-08-31' },
    day(557),
    day(557, 10),
    day(600, 11),
    { ...day(600), work_date: '2026-10-01' },
  ];
  assert.deepEqual(presentDaySurplus(days, '2026-09-01', '2026-09-10'), {
    presentDays: 2,
    surplusMinutes: 4,
  });
});

test('surplus stays in minutes even when it exceeds an hour', () => {
  const days = Array.from({ length: 10 }, (_, index) => day(565, index + 1));
  assert.equal(presentDaySurplus(days, '2026-09-01', '2026-09-10').surplusMinutes, 100);
});
