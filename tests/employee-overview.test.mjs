import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

const stubs = {
  '@/lib/db/server': 'export const createClient = () => globalThis.overviewTest.client;',
  '@/lib/db/mongo': `
    export const isMongoConfigured = () => true;
    export const db = () => { throw new Error('Unexpected database access'); };
  `,
  '@/lib/db/repo': `
    export const afterParentCheck = () => {};
    export class NotSignedInError extends Error {}
    export const scoped = () => {};
  `,
  '@/lib/db/scheduler': 'export const deleteExpiredNotices = () => {};',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in stubs) {
      return { url: `overview-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('overview-test:')) {
      return {
        format: 'module',
        source: stubs[url.slice('overview-test:'.length)],
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { getEmployeeOverview } = await import('../src/lib/queries.ts');

beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-10T15:00:00Z') });
  const days = Array.from({ length: 10 }, (_, index) => ({
    work_date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    status: 'P',
    worked_minutes: 557,
  }));
  globalThis.overviewTest = {
    days,
    client: {
      from: (table) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          gte: () => builder,
          lte: () => builder,
          maybeSingle: async () => {
            const data = {
              employees: { full_name: 'Test Employee', code: 'DN001', branches: { name: 'Pune' } },
              settings: { value: 555 },
              payslips: null,
            };
            return { data: data[table], error: null };
          },
          then: (resolve, reject) =>
            Promise.resolve({ data: days, error: null }).then(resolve, reject),
        };
        return builder;
      },
    },
  };
  t.after(() => delete globalThis.overviewTest);
});

test('employee overview exposes worked hours and the requested twenty-minute surplus', async () => {
  const overview = await getEmployeeOverview('employee-1', null, '2026-09-01');
  assert.equal(overview.workedHours, '92:50');
  assert.equal(overview.surplusMinutes, 20);
  assert.equal(overview.surplusPresentDays, 10);
  assert.equal(overview.pendingMinutes, 0);
});

test('surplus excludes leave days even though they contribute to the payroll target', async () => {
  globalThis.overviewTest.days.push({ work_date: '2026-09-10', status: 'CO', worked_minutes: 0 });
  const overview = await getEmployeeOverview('employee-1', null, '2026-09-01');
  assert.equal(overview.surplusMinutes, 20);
  assert.equal(overview.surplusPresentDays, 10);
});

test('unlinked accounts have zero surplus and zero present days', async () => {
  const overview = await getEmployeeOverview(null, 'Unlinked User', '2026-09-01');
  assert.equal(overview.name, 'Unlinked User');
  assert.equal(overview.surplusMinutes, 0);
  assert.equal(overview.surplusPresentDays, 0);
});
