import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

// Exercise the real scheduler against isolated storage; tests never connect to the company database.
const stubs = {
  'server-only': 'export {};',
  '@/lib/db/repo': 'export const scopedFor = (name) => globalThis.sweepTestStore(name);',
  '@/lib/db/scope': 'export const systemScope = { isSystem: true };',
  '@/lib/db/functions':
    'export const scheduled = {}; export async function provisionLeaveBalances() {}',
  '@/lib/db/server':
    'export function createClient() { throw new Error("Unexpected database access"); }',
  '@/lib/db/mongo':
    'export const isMongoConfigured = () => false; export function db() { throw new Error("Unexpected database access"); }',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in stubs) {
      return { url: `sweep-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('sweep-test:')) {
      return {
        format: 'module',
        source: stubs[url.slice('sweep-test:'.length)],
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const { collections } = await import('../src/lib/db/collections.ts');
const { autoPunchOut } = await import('../src/lib/db/scheduler.ts');

let rows;
let failNotification;
let raceId;

function same(a, b) {
  return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
}
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value === null) {
      return row[key] == null;
    }
    if (value && typeof value === 'object' && '$ne' in value) {
      return !same(row[key] ?? null, value.$ne);
    }
    return same(row[key], value);
  });
}

beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T19:00:00Z') });
  rows = Object.fromEntries(Object.values(collections).map((name) => [name, []]));
  failNotification = false;
  raceId = null;
  globalThis.sweepTestStore = (name) => ({
    find: async (query) =>
      rows[name].filter((row) => matches(row, query)).map((row) => ({ ...row })),
    findOne: async (query) => rows[name].find((row) => matches(row, query)) ?? null,
    insertOne: async (row) => {
      if (
        name === collections.cronRunLog &&
        rows[name].some((old) => old.job === row.job && old.run_key === row.run_key)
      ) {
        throw Object.assign(new Error('Duplicate claim'), { code: 11000 });
      }
      rows[name].push(row);
    },
    deleteMany: async (query) => {
      rows[name] = rows[name].filter((row) => !matches(row, query));
    },
    updateOne: async (query, update) => {
      if (query._id === raceId) {
        Object.assign(
          rows[name].find((row) => row._id === raceId),
          { punch_out: '17:45', updated_at: new Date() },
        );
      }
      const row = rows[name].find((candidate) => matches(candidate, query));
      if (!row) {
        return 0;
      }
      Object.assign(row, update.$set);
      return 1;
    },
    upsertOne: async (query, update) => {
      if (failNotification) {
        failNotification = false;
        throw new Error('Notification unavailable');
      }
      if (!rows[name].some((row) => matches(row, query))) {
        rows[name].push(update.$setOnInsert);
      }
    },
  });
  t.after(() => {
    delete globalThis.sweepTestStore;
  });
});

function addDay(id, overrides = {}) {
  rows[collections.attendanceDays].push({
    _id: id,
    employee_id: id,
    work_date: '2026-09-15',
    punch_in: '09:00',
    punch_out: null,
    updated_at: new Date('2026-09-15T04:00:00Z'),
    ...overrides,
  });
  rows[collections.users].push({ _id: `user-${id}`, employee_id: id, disabled: false });
}

test('scheduled sweep notifies only employees it actually closes, once per day', async () => {
  addDay('missed');
  addDay('completed', { punch_out: '17:30' });
  addDay('absent', { punch_in: null });
  addDay('raced');
  raceId = 'raced';
  const result = await autoPunchOut('2026-09-15');
  assert.equal(result.affected, 1);
  const notifications = rows[collections.notifications];
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_id, 'user-missed');
  assert.match(notifications[0].body, /18:00 IST/);
  assert.equal(
    rows[collections.attendanceDays].find((row) => row._id === 'raced').punch_out,
    '17:45',
  );
  assert.equal((await autoPunchOut('2026-09-15')).ran, false);
  assert.equal(notifications.length, 1);
});

test('notification failure retries without closing attendance twice or duplicating notifications', async () => {
  addDay('missed');
  failNotification = true;
  await assert.rejects(autoPunchOut('2026-09-15'), /Notification unavailable/);
  assert.equal(rows[collections.cronRunLog].length, 0);
  assert.equal(rows[collections.attendanceDays][0].auto_close_source, 'scheduled');
  assert.equal((await autoPunchOut('2026-09-15')).affected, 0);
  assert.equal(rows[collections.notifications].length, 1);
});

test('sealed payroll and empty days do not create missed-punch notifications', async () => {
  assert.equal((await autoPunchOut('2026-09-14')).affected, 0);
  addDay('missed');
  rows[collections.payrollRuns].push({ period_month: '2026-09-01', status: 'locked' });
  assert.equal((await autoPunchOut('2026-09-15')).affected, 0);
  assert.equal(rows[collections.notifications].length, 0);
  assert.equal(rows[collections.attendanceDays][0].punch_out, null);
});
