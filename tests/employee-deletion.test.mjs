import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

// Run the server actions against isolated records; never connect to the company database.
const stubs = {
  'next/cache': 'export const revalidatePath = (path) => globalThis.deletionTest.paths.push(path);',
  '@/lib/db/server': `
    export const createClient = () => globalThis.deletionTest.client;
    export const createServiceClient = createClient;
    export const isServiceRoleConfigured = () => true;
  `,
  '@/lib/actions/guards': `
    export const requireStaff = () => globalThis.deletionTest.gate;
    export const requireRoles = requireStaff;
    export const wroteNothing = (rows) => !rows?.length;
  `,
  '@/lib/db/collections': `
    export const collections = { employees: 'employees' };
    export const usersCollection = () => globalThis.deletionTest.users;
  `,
  '@/lib/db/mongo': `
    export const isMongoConfigured = () => true;
    export const db = () => globalThis.deletionTest.database;
  `,
  '@/lib/queries': 'export const getEmployeeForEdit = () => null;',
  '@/lib/email': `
    export const isEmailConfigured = () => false;
    export const escapeHtml = (value) => value;
    export async function sendEmail() {}
  `,
  '@/lib/documents/templates': 'export const buildWelcomeEmail = () => "";',
  '@/lib/actions/onboarding': 'export async function startOnboarding() {}',
  '@/lib/auth':
    'export const isEmployeeAreaRole = (role) => ["employee", "intern"].includes(role);',
  '@/lib/auth/password': `
    export const validatePassword = () => null;
    export const hashPassword = () => { throw new Error('Unexpected password hashing'); };
  `,
  '@/lib/auth/reset-tokens': `
    export async function createResetToken() {}
    export const resetTokenTtlMinutes = 15;
  `,
  '@/lib/auth/origin': `
    export const appOrigin = () => null;
    export const originNotConfigured = 'Origin unavailable';
  `,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in stubs) {
      return { url: `deletion-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('deletion-test:')) {
      return {
        format: 'module',
        source: stubs[url.slice('deletion-test:'.length)],
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { deleteEmployee } = await import('../src/lib/actions/employee-deletion.ts');
const { reactivateEmployee } = await import('../src/lib/actions/employees.ts');
const { createUser, setUserDisabled, updateUserRole } = await import('../src/lib/actions/users.ts');

let fixture;

function query(table) {
  const filters = [];
  let update;
  let insert;
  const builder = {
    select: () => builder,
    limit: () => builder,
    eq: (key, value) => {
      filters.push((row) => row[key] === value);
      return builder;
    },
    is: (key, value) => {
      filters.push((row) => (row[key] ?? null) === value);
      return builder;
    },
    neq: (key, value) => {
      filters.push((row) => row[key] !== value);
      return builder;
    },
    update: (values) => {
      update = values;
      return builder;
    },
    insert: (values) => {
      insert = values;
      return builder;
    },
    maybeSingle: async () => {
      const result = execute();
      return { ...result, data: result.data?.[0] ?? null };
    },
    then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject),
  };
  function execute() {
    const error =
      table === 'profiles'
        ? fixture.loginError
        : table === 'activity_log'
          ? fixture.auditError
          : update
            ? fixture.writeError
            : fixture.readError;
    if (error) {
      return { data: null, error: { message: error } };
    }
    if (insert) {
      fixture.rows[table].push(insert);
      return { data: [insert], error: null };
    }
    if (update && fixture.reactivateBeforeWrite) {
      fixture.rows.employees[0].status = 'active';
    }
    const rows = fixture.rows[table].filter((row) => filters.every((filter) => filter(row)));
    if (update) {
      for (const row of rows) {
        Object.assign(row, update);
      }
    }
    return { data: rows.map((row) => ({ ...row })), error: null };
  }
  return builder;
}

beforeEach((t) => {
  fixture = {
    gate: { ok: true, profileId: 'admin-1', employeeId: null, role: 'admin' },
    paths: [],
    userWrites: 0,
    rows: {
      employees: [
        { id: 'employee-1', code: 'DN001', full_name: 'Test Employee', status: 'inactive' },
      ],
      profiles: [
        {
          id: 'user-1',
          _id: 'user-1',
          employee_id: 'employee-1',
          disabled: true,
          role: 'employee',
        },
      ],
      activity_log: [],
      attendance_days: [{ employee_id: 'employee-1', work_date: '2026-09-01' }],
      payslips: [{ employee_id: 'employee-1', period_month: '2026-09-01' }],
    },
    client: { from: query },
    users: {
      findOne: async ({ _id }) => fixture.rows.profiles.find((row) => row._id === _id),
      updateOne: async () => {
        fixture.userWrites++;
        return { matchedCount: 1 };
      },
    },
    database: {
      collection: () => ({
        findOne: async ({ _id }) => fixture.rows.employees.find((row) => row.id === _id),
      }),
    },
  };
  globalThis.deletionTest = fixture;
  t.after(() => {
    delete globalThis.deletionTest;
  });
});

test('only staff can delete employees, and blank or missing selections fail', async () => {
  const staffGate = fixture.gate;
  fixture.gate = { ok: false, error: 'Staff access required.' };
  assert.deepEqual(await deleteEmployee('DN001'), fixture.gate);
  fixture.gate = staffGate;
  assert.equal((await deleteEmployee(' ')).ok, false);
  assert.equal((await deleteEmployee('missing')).ok, false);
  assert.equal(fixture.rows.employees[0].deleted_at, undefined);
});

test('active, on-notice, own, and already deleted employees cannot be deleted', async () => {
  const employee = fixture.rows.employees[0];
  for (const status of ['active', 'on_notice']) {
    employee.status = status;
    assert.match((await deleteEmployee('DN001')).error, /Deactivate/);
  }
  employee.status = 'inactive';
  fixture.gate.employeeId = employee.id;
  assert.match((await deleteEmployee('DN001')).error, /own employee record/);
  fixture.gate.employeeId = null;
  employee.deleted_at = new Date();
  assert.match((await deleteEmployee('DN001')).error, /already been deleted/);
  assert.equal(fixture.rows.activity_log.length, 0);
});

test('enabled logins or failed prerequisite reads block deletion', async () => {
  fixture.rows.profiles[0].disabled = false;
  assert.match((await deleteEmployee('DN001')).error, /enabled login/);
  fixture.rows.profiles[0].disabled = true;
  fixture.loginError = 'Login lookup unavailable';
  assert.match((await deleteEmployee('DN001')).error, /Login lookup unavailable/);
  fixture.readError = 'Employee lookup unavailable';
  assert.match((await deleteEmployee('DN001')).error, /Employee lookup unavailable/);
  assert.equal(fixture.rows.employees[0].deleted_at, undefined);
});

test('deletion preserves historical records, disabled logins, and employee identity', async () => {
  const history = structuredClone({
    attendance: fixture.rows.attendance_days,
    payslips: fixture.rows.payslips,
    logins: fixture.rows.profiles,
  });
  assert.deepEqual(await deleteEmployee(' DN001 '), { ok: true });
  assert.equal(fixture.rows.employees.length, 1);
  assert.ok(fixture.rows.employees[0].deleted_at instanceof Date);
  assert.equal(fixture.rows.employees[0].deleted_by, 'admin-1');
  assert.deepEqual(
    {
      attendance: fixture.rows.attendance_days,
      payslips: fixture.rows.payslips,
      logins: fixture.rows.profiles,
    },
    history,
  );
  assert.equal(fixture.rows.activity_log[0].event_type, 'employee_deleted');
  assert.equal(fixture.rows.activity_log[0].employee_id, 'employee-1');
  assert.deepEqual(fixture.paths, ['/employees', '/users']);
  assert.equal((await deleteEmployee('DN001')).ok, false);
});

test('a concurrent reactivation or failed update cannot delete the employee', async () => {
  fixture.writeError = 'Write unavailable';
  assert.match((await deleteEmployee('DN001')).error, /Write unavailable/);
  fixture.writeError = null;
  fixture.reactivateBeforeWrite = true;
  assert.match((await deleteEmployee('DN001')).error, /employee changed/);
  assert.equal(fixture.rows.employees[0].deleted_at, undefined);
  assert.equal(fixture.rows.activity_log.length, 0);
});

test('audit failure reports a warning after a successful deletion', async () => {
  fixture.auditError = 'Audit unavailable';
  const result = await deleteEmployee('DN001');
  assert.equal(result.ok, true);
  assert.match(result.warning, /audit entry/);
  assert.ok(fixture.rows.employees[0].deleted_at instanceof Date);
});

test('deleted employees cannot be reactivated or have linked logins enabled', async () => {
  await deleteEmployee('DN001');
  assert.equal((await reactivateEmployee('DN001')).ok, false);
  assert.match((await setUserDisabled('user-1', false)).error, /deleted employee/);
  assert.equal(fixture.rows.employees[0].status, 'inactive');
  assert.equal(fixture.userWrites, 0);
});

test('new or reassigned logins cannot link to a deleted employee', async () => {
  await deleteEmployee('DN001');
  const form = new FormData();
  for (const [key, value] of Object.entries({
    email: 'employee@example.test',
    password: 'test-password-123',
    full_name: 'Test Employee',
    role: 'employee',
    employee_id: 'employee-1',
  })) {
    form.set(key, value);
  }
  assert.match((await createUser(form)).error, /deleted employee/);
  fixture.rows.profiles[0].employee_id = null;
  fixture.rows.profiles[0].disabled = false;
  assert.match(
    (await updateUserRole('user-1', 'employee', 'employee-1')).error,
    /deleted employee/,
  );
  assert.equal(fixture.userWrites, 0);
});
