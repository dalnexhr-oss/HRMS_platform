import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './helpers/load-typescript.mjs';

function workflow({
  attendance = [],
  monthStatus = {},
  holidayDates = [],
  policyFailure = false,
} = {}) {
  const writes = [];
  const client = {
    from(table) {
      const call = { table, filters: {}, operation: 'select', values: null };
      const builder = new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === 'then') {
              return (resolve) => {
                if (call.operation !== 'select') {
                  writes.push(call);
                  return resolve({ error: null });
                }
                return resolve({
                  data:
                    table === 'attendance_days'
                      ? attendance
                      : (monthStatus[call.filters.period_month] ?? null),
                  error: null,
                });
              };
            }
            return (...args) => {
              if (key === 'update' || key === 'insert') {
                call.operation = key;
                call.values = args[0];
              }
              if (key === 'eq' || key === 'in') {
                call.filters[args[0]] = args[1];
              }
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  const policy = { weekOffWeekdays: [0, 6], workingSaturdays: [2, 4] };
  const functions = loadTypeScript('src/lib/requests/leave-attendance.ts', {
    '@/lib/db/server-client': { createClient: async () => client },
    '@/lib/queries/settings': {
      getWeekOffPolicy: async () => {
        if (policyFailure) {
          throw new Error('Policy unavailable');
        }
        return policy;
      },
    },
    '@/lib/queries/holidays': { getHolidays: async () => holidayDates.map((date) => ({ date })) },
  });
  return { ...functions, client, writes };
}

test('leave stamping preserves presence and off-days, updates absences, and skips holidays', async () => {
  const instance = workflow({
    attendance: [
      { work_date: '2026-09-01', status: 'P' },
      { work_date: '2026-09-02', status: 'AB' },
      { work_date: '2026-09-03', status: 'WO' },
    ],
    holidayDates: ['2026-09-07'],
  });
  assert.equal(
    await instance.stampLeaveOnRegister(instance.client, 'employee', '2026-09-01', '2026-09-07'),
    null,
  );
  assert.deepEqual(instance.writes[0].filters, {
    employee_id: 'employee',
    status: 'AB',
    work_date: ['2026-09-02'],
  });
  assert.deepEqual(instance.writes[1].values, [
    { employee_id: 'employee', work_date: '2026-09-04', status: 'L' },
  ]);
});

test('closed payroll months stay untouched when leave crosses a month boundary', async () => {
  const instance = workflow({ monthStatus: { '2026-09-01': { status: 'locked' } } });
  const warning = await instance.stampLeaveOnRegister(
    instance.client,
    'employee',
    '2026-09-30',
    '2026-10-01',
  );
  assert.match(warning, /2026-09.*1 day/);
  assert.deepEqual(instance.writes[0].values, [
    { employee_id: 'employee', work_date: '2026-10-01', status: 'L' },
  ]);
});

test('policy failures stop follow-up writes and retain the calendar-day fallback', async () => {
  const instance = workflow({ policyFailure: true });
  assert.match(
    await instance.stampLeaveOnRegister(instance.client, 'employee', '2026-09-01', '2026-09-03'),
    /policy unreadable/,
  );
  assert.deepEqual(instance.writes, []);
  assert.equal(
    await instance.leaveDayCount(
      '2026-09-01',
      '2026-09-03',
      new Date('2026-09-01'),
      new Date('2026-09-03'),
    ),
    3,
  );
});
