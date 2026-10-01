import assert from 'node:assert/strict';
import { loadTypeScript } from './load-typescript.mjs';

function payrollFixture(overrides = {}, sourceOverrides = {}) {
  const session = {};
  const writes = [];
  const collections = Object.fromEntries(
    [
      'employees',
      'payrollRuns',
      'attendanceDays',
      'branches',
      'settings',
      'payslips',
      'payslipAdjustments',
      'ptSlabs',
    ].map((name) => [name, name]),
  );
  const fixture = {
    employee: {
      _id: 'employee',
      branch_id: 'branch',
      gross_monthly: '30000',
      basic_da: '15000',
      hra: '9000',
      special_allowance: '6000',
      gender: 'male',
    },
    run: { _id: 'run', period_month: '2026-04-01', status: 'draft' },
    attendance: Array.from({ length: 30 }, () => ({ status: 'P', worked_minutes: 555 })),
    settings: {},
    branch: null,
    slabs: [],
    adjustment: null,
    existing: null,
    ...overrides,
  };
  const functions = loadTypeScript(
    'src/lib/db/payroll-processing.ts',
    {
      '@/lib/db/collection-registry': { collections },
      '@/lib/db/access-scope': { systemScope: {} },
      '@/lib/db/scoped-query-client': { registerRpc: () => {} },
      '@/lib/db/mongodb-connection': {
        withTransaction: async (callback, options) => {
          assert.equal(options.required, true);
          return callback(session);
        },
      },
      '@/lib/db/scoped-repository': {
        scopedFor: (collection, _scope, suppliedSession) => {
          assert.equal(suppliedSession, session);
          return {
            async findOne(filter) {
              if (collection === 'employees') {
                return fixture.employee;
              }
              if (collection === 'payrollRuns') {
                return fixture.run;
              }
              if (collection === 'branches') {
                return fixture.branch;
              }
              if (collection === 'payslips') {
                return fixture.existing;
              }
              if (collection === 'payslipAdjustments') {
                return fixture.adjustment;
              }
              if (collection === 'settings') {
                return Object.hasOwn(fixture.settings, filter.key)
                  ? { value: fixture.settings[filter.key] }
                  : null;
              }
              assert.fail(`Unexpected read from ${collection}`);
            },
            async find() {
              if (collection === 'attendanceDays') {
                return fixture.attendance;
              }
              if (collection === 'ptSlabs') {
                return fixture.slabs;
              }
              if (collection === 'employees') {
                return [fixture.employee];
              }
              assert.fail(`Unexpected query on ${collection}`);
            },
            async updateOne(filter, update) {
              if (collection === 'payrollRuns' && update.$inc) {
                assert.deepEqual(filter.status, { $in: ['draft', 'in_review'] });
                return ['draft', 'in_review'].includes(fixture.run?.status) ? 1 : 0;
              }
              writes.push({ collection, filter, update });
              return 1;
            },
            async insertOne(document) {
              writes.push({ collection, document });
            },
            async updateMany(filter, update) {
              writes.push({ collection, filter, update });
            },
          };
        },
      },
    },
    sourceOverrides,
  );
  return { ...functions, writes };
}

export { payrollFixture };
