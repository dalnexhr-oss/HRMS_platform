import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastNightSweepNotice, previousWorkDate } from '../src/lib/night-sweep.ts';

const now = new Date('2026-09-15T19:00:00Z'); // September 16 in India.
const day = {
  work_date: '2026-09-15',
  punch_in: '09:00',
  punch_out: '18:00',
  auto_close_source: 'scheduled',
  auto_closed_at: new Date('2026-09-15T18:30:00Z'),
};

test('warns only for yesterday’s missed punch closed by today’s scheduled sweep in IST', () => {
  const notice = lastNightSweepNotice(day, now);
  assert.equal(notice?.workDate, '2026-09-15');
  assert.equal(notice?.punchOut, '18:00');
  assert.match(notice?.message, /Last night’s automatic sweep/);
  assert.match(notice?.message, /Contact HR/);
});

test('missing, manual, stale, corrected, and future closures do not trigger a warning', () => {
  for (const row of [
    null,
    {},
    { ...day, auto_close_source: null },
    { ...day, auto_close_source: 'manual' },
    { ...day, work_date: '2026-09-14' },
    { ...day, work_date: '2026-09-16' },
    { ...day, punch_in: null },
    { ...day, punch_out: null },
    { ...day, auto_closed_at: null },
    { ...day, auto_closed_at: 'invalid' },
    { ...day, auto_closed_at: '2026-09-15T18:29:59Z' },
    { ...day, auto_closed_at: '2026-09-15T19:01:00Z' },
  ]) {
    assert.equal(lastNightSweepNotice(row, now), null);
  }
  assert.equal(lastNightSweepNotice(day, new Date('2026-09-16T18:30:00Z')), null);
});

test('previous work date handles month, year, and leap-day boundaries', () => {
  assert.equal(previousWorkDate('2026-01-01'), '2025-12-31');
  assert.equal(previousWorkDate('2024-03-01'), '2024-02-29');
  assert.equal(previousWorkDate('2026-03-01'), '2026-02-28');
});
