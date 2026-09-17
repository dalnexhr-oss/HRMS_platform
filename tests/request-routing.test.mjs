import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';
import { Decimal128 } from 'mongodb';
import { defaultWeekOffPolicy } from '../src/lib/week-off.ts';

// Exercise real actions and collection policies against isolated records, never the company DB.
const stubs = {
  'server-only': '',
  'next/cache': 'export const revalidatePath = (path) => globalThis.requestTest.paths.push(path);',
  '@/lib/auth': 'export const getSession = () => globalThis.requestTest.session;',
  '@/lib/db/mongo': `
    export const isMongoConfigured = () => true;
    export const db = () => globalThis.requestTest.database;
  `,
  '@/lib/db/repo': 'export const scoped = (name) => globalThis.requestTest.scoped(name);',
  '@/lib/db/server': `
    export const createClient = () => globalThis.requestTest.client;
    export const createServiceClient = () => globalThis.requestTest.serviceClient;
  `,
  '@/lib/queries': `
    export const isMongoConfigured = () => true;
    export const getWeekOffPolicy = () => globalThis.requestTest.policy;
    export const getHolidays = () => [];
  `,
  '@/lib/actions/guards': `
    export const requireStaff = () => globalThis.requestTest.staffGate();
    export const requireDb = () => ({ ok: true });
    export const requireOpenPayrollMonth = () => ({ ok: true });
    export const wroteNothing = (rows) => !rows?.length;
  `,
  '@/lib/notify': `
    export const notifyProfiles = (ids, input) => globalThis.requestTest.notify(ids, input);
    export const notifyEmployee = (id, input) => globalThis.requestTest.notifyEmployee(id, input);
    export const notifyApprovers = () => { globalThis.requestTest.broadcasts++; };
  `,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier in stubs
      ? { url: `request-test:${specifier}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url.startsWith('request-test:')
      ? { format: 'module', source: stubs[url.slice(13)], shortCircuit: true }
      : nextLoad(url, context);
  },
});

const { policies } = await import('../src/lib/db/policies.ts');
const { getRequestRecipients, prepareRequestRouting, reviewRoutedRequest } =
  await import('../src/lib/requests/routing.ts');
const { createRequest, reviewRequest, cancelRequest } =
  await import('../src/lib/actions/requests.ts');
const { applyCompOff } = await import('../src/lib/actions/comp-off.ts');

let store;
const decimal = (value) => Decimal128.fromString(String(value));
const copy = (value) => {
  if (value instanceof Date) {
    return new Date(value);
  }
  if (value instanceof Decimal128 || value == null || typeof value !== 'object') {
    return value;
  }
  return Array.isArray(value)
    ? value.map(copy)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
};
function valuesAt(value, path) {
  if (!path.length) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => valuesAt(item, path));
  }
  return valuesAt(value?.[path[0]], path.slice(1));
}
function equal(a, b) {
  if (a instanceof Decimal128 || b instanceof Decimal128) {
    return String(a) === String(b);
  }
  return (a ?? null) === (b ?? null);
}
function matches(row, filter) {
  if (!filter) {
    return false;
  }
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return expected.some((part) => matches(row, part));
    }
    if (key === '$and') {
      return expected.every((part) => matches(row, part));
    }
    const values = valuesAt(row, (key === 'id' ? '_id' : key).split('.'));
    if (expected && typeof expected === 'object' && !(expected instanceof Decimal128)) {
      if ('$in' in expected) {
        return values.some((value) => expected.$in.includes(value));
      }
      if ('$ne' in expected) {
        return values.every((value) => !equal(value, expected.$ne));
      }
      if ('$gte' in expected) {
        return values.some((value) => value >= expected.$gte);
      }
      if ('$lte' in expected) {
        return values.some((value) => value <= expected.$lte);
      }
    }
    return values.some((value) => equal(value, expected));
  });
}
function setAt(row, key, value) {
  const path = key.split('.');
  const last = path.pop();
  const parent = path.reduce((item, part) => (item[part] ??= {}), row);
  parent[last] = value;
}
function updateRow(row, update) {
  for (const [key, value] of Object.entries(update.$set ?? {})) {
    setAt(row, key, copy(value));
  }
  for (const [key, value] of Object.entries(update.$inc ?? {})) {
    setAt(row, key, valuesAt(row, key.split('.'))[0] + value);
  }
  for (const [key, value] of Object.entries(update.$push ?? {})) {
    valuesAt(row, key.split('.'))[0].push(copy(value));
  }
}
function scope() {
  const profile = store.session.profile;
  const isStaff = ['admin', 'hr', 'super_admin'].includes(profile?.role);
  return {
    userId: profile?.id,
    employeeId: profile?.employee_id,
    role: profile?.role,
    isStaff,
    isAdminHr: isStaff,
    isSuperAdmin: profile?.role === 'super_admin',
    isSystem: false,
  };
}
function rawCollection(name) {
  return {
    find: (filter = {}) => ({
      toArray: async () => store.rows[name].filter((row) => matches(row, filter)).map(copy),
    }),
    findOne: async (filter) => copy(store.rows[name].find((row) => matches(row, filter)) ?? null),
    findOneAndUpdate: async (filter, update) => {
      store.beforeDecision?.();
      const row = store.rows[name].find((row) => matches(row, filter));
      if (!row) {
        return null;
      }
      if (store.failDecision) {
        throw new Error('Decision storage unavailable');
      }
      updateRow(row, update);
      store.writes.push(name);
      return copy(row);
    },
  };
}
function query(name, service = false) {
  const filters = [];
  let update;
  let inserts;
  let upsert;
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (key, value) => {
      filters.push({ [key]: value });
      return builder;
    },
    is: (key, value) => {
      filters.push({ [key]: value });
      return builder;
    },
    in: (key, value) => {
      filters.push({ [key]: { $in: value } });
      return builder;
    },
    gte: (key, value) => {
      filters.push({ [key]: { $gte: value } });
      return builder;
    },
    lte: (key, value) => {
      filters.push({ [key]: { $lte: value } });
      return builder;
    },
    update: (value) => {
      update = value;
      return builder;
    },
    insert: (value) => {
      inserts = Array.isArray(value) ? value : [value];
      return builder;
    },
    upsert: (value) => {
      upsert = value;
      return builder;
    },
    maybeSingle: async () => {
      const result = execute();
      return { ...result, data: result.data?.[0] ?? null };
    },
    then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject),
  };
  function execute() {
    const policy = policies[name];
    if (upsert) {
      const row = store.rows[name].find(
        (row) => row.employee_id === upsert.employee_id && row.work_date === upsert.work_date,
      );
      if (row) {
        Object.assign(row, upsert);
        store.writes.push(name);
        return { data: [copy(row)], error: null };
      }
      inserts = [upsert];
    }
    if (inserts) {
      const made = inserts.map((input) => ({
        _id: `new-${++store.sequence}`,
        created_at: new Date(),
        ...copy(input),
      }));
      for (const row of made) {
        const refusal = service ? null : policy?.insert(scope(), row);
        if (refusal) {
          return { data: null, error: { message: refusal } };
        }
      }
      store.rows[name].push(...made);
      store.writes.push(name);
      return { data: made.map((row) => ({ ...copy(row), id: row._id })), error: null };
    }
    const allowed = service ? {} : update ? policy?.write(scope()) : policy?.read(scope());
    const rows = store.rows[name].filter(
      (row) => matches(row, allowed) && filters.every((filter) => matches(row, filter)),
    );
    if (update) {
      const refusal = service ? null : policy?.check?.(scope(), update);
      if (refusal) {
        return { data: null, error: { message: refusal } };
      }
      for (const row of rows) {
        Object.assign(row, copy(update));
      }
      if (rows.length) {
        store.writes.push(name);
      }
    }
    return { data: rows.map((row) => ({ ...copy(row), id: row._id })), error: null };
  }
  return builder;
}
function actor(id) {
  const user = store.rows.users.find((candidate) => candidate._id === id);
  store.session = { profile: user ? { ...copy(user), id: user._id } : null, email: user?.email };
}
function form(to = 'hr', cc = ['cc']) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    type: 'leave',
    leave_kind: 'LWP',
    start_date: '2026-09-21',
    end_date: '2026-09-21',
    reason: 'Family event',
    approver_id: to,
  })) {
    data.set(key, value);
  }
  cc.forEach((id) => data.append('cc_ids', id));
  return data;
}
async function submit() {
  assert.equal((await createRequest(form())).ok, true);
  store.writes = [];
  store.notifications = [];
  return store.rows.requests[0];
}
beforeEach((t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-17T06:00:00Z') });
  store = {
    rows: {
      users: [
        {
          _id: 'owner',
          employee_id: 'e-owner',
          role: 'employee',
          full_name: 'Applicant',
          email: 'applicant@company.test',
          disabled: false,
        },
        {
          _id: 'hr',
          employee_id: 'e-hr',
          role: 'hr',
          full_name: 'HR',
          email: 'hr@company.test',
          disabled: false,
        },
        {
          _id: 'tech',
          employee_id: 'e-tech',
          role: 'employee',
          full_name: 'Tech lead',
          email: 'tech@company.test',
          disabled: false,
        },
        {
          _id: 'cc',
          employee_id: 'e-cc',
          role: 'employee',
          full_name: 'CC Person',
          email: 'cc@company.test',
          disabled: false,
        },
        {
          _id: 'admin',
          employee_id: null,
          role: 'admin',
          full_name: 'Admin',
          email: 'admin@company.test',
          disabled: false,
        },
      ],
      employees: ['owner', 'hr', 'tech', 'cc'].map((id) => ({
        _id: `e-${id}`,
        full_name: `${id} employee`,
        code: `DN-${id}`,
        branch_name: 'Pune',
        department_name: id === 'tech' ? 'Engineering' : 'Operations',
        status: 'active',
        deleted_at: null,
      })),
      requests: [],
      approval_steps: [],
      settings: [],
      payroll_runs: [],
      attendance_days: [],
      leave_balances: [
        { _id: 'balance', employee_id: 'e-owner', year: 2026, type: 'PL', balance: decimal(10) },
      ],
      comp_offs: [
        {
          _id: 'credit',
          employee_id: 'e-owner',
          status: 'available',
          is_applicable: true,
          earned_date: '2026-09-13',
          used_date: null,
          request_id: null,
        },
      ],
    },
    sequence: 0,
    paths: [],
    writes: [],
    broadcasts: 0,
    notifications: [],
    policy: defaultWeekOffPolicy,
    database: { collection: rawCollection },
    client: {
      from: (name) => query(name),
      rpc: async () => {
        throw new Error('New routed requests must not seed legacy role approvals');
      },
    },
    serviceClient: { from: (name) => query(name, true) },
    scoped: (name) => ({
      findOne: async (filter) =>
        copy(
          store.rows[name].find(
            (row) => matches(row, filter) && matches(row, policies[name].read(scope())),
          ) ?? null,
        ),
    }),
    staffGate: () =>
      scope().isStaff
        ? {
            ok: true,
            profileId: store.session.profile.id,
            employeeId: store.session.profile.employee_id,
            role: store.session.profile.role,
          }
        : { ok: false, error: 'Staff access required.' },
    notify: (ids, input) => {
      store.notifications.push(...[...new Set(ids)].map((id) => ({ id, ...input })));
    },
    notifyEmployee: (employeeId, input) =>
      store.notify(
        store.rows.users.filter((user) => user.employee_id === employeeId).map((user) => user._id),
        input,
      ),
  };
  globalThis.requestTest = store;
  actor('owner');
  t.after(() => {
    delete globalThis.requestTest;
  });
});

test('recipient directory exposes only active company accounts and minimal searchable details', async () => {
  store.rows.users.find((user) => user._id === 'cc').disabled = true;
  store.rows.employees.find((employee) => employee._id === 'e-hr').deleted_at = new Date();
  store.rows.users[2].password_hash = 'private';
  const people = await getRequestRecipients();
  assert.deepEqual(people.map((person) => person.id).sort(), ['admin', 'tech']);
  assert.match(people.find((person) => person.id === 'tech').detail, /Engineering/);
  assert.equal(JSON.stringify(people).includes('private'), false);
});

test('submitting resolves typed selections, deduplicates CC, and notifies only To and CC', async () => {
  const result = await createRequest(form('hr', ['cc', 'cc', 'hr']));
  assert.equal(result.ok, true);
  const request = store.rows.requests[0];
  assert.equal(request.approval_route.current_approver.id, 'hr');
  assert.deepEqual(
    request.approval_route.cc.map((person) => person.id),
    ['cc'],
  );
  assert.equal(request.employee_name, 'owner employee');
  assert.deepEqual(store.notifications.map((notice) => notice.id).sort(), ['cc', 'hr']);
  assert.ok(store.notifications.every((notice) => notice.link === `/requests/${request._id}`));
  assert.equal(store.broadcasts, 0);
});

test('submission rejects missing, invented, self, disabled, and inactive recipients', async () => {
  for (const id of ['', 'external@example.test', 'owner']) {
    assert.equal((await createRequest(form(id))).ok, false);
  }
  store.rows.users.find((user) => user._id === 'hr').disabled = true;
  assert.equal((await createRequest(form())).ok, false);
  store.rows.users.find((user) => user._id === 'hr').disabled = false;
  store.rows.employees.find((employee) => employee._id === 'e-hr').status = 'inactive';
  assert.equal((await createRequest(form())).ok, false);
  assert.equal(store.rows.requests.length, 0);
});

test('CC can read only tagged requests and cannot approve, reject, or replace recipients', async () => {
  const request = await submit();
  actor('cc');
  assert.ok(await store.scoped('requests').findOne({ _id: request._id }));
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 0)).ok, false);
  assert.equal((await reviewRequest(request._id, 'rejected', '', undefined, 0)).ok, false);
  assert.equal(matches(request, policies.requests.write(scope())), false);
  assert.ok(policies.requests.check(scope(), { approval_route: {} }));
  actor('tech');
  assert.equal(await store.scoped('requests').findOne({ _id: request._id }), null);
});

test('even admins and the applicant cannot take over an assigned approval', async () => {
  const request = await submit();
  for (const id of ['admin', 'owner', 'tech']) {
    actor(id);
    assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 0)).ok, false);
  }
  assert.equal(request.status, 'pending');
  assert.equal(request.approval_route.history.length, 0);
});

test('approve and forward records the stage, preserves CC, and defers all leave effects', async () => {
  const request = await submit();
  actor('hr');
  const result = await reviewRequest(
    request._id,
    'approved',
    'Please check team coverage',
    'tech',
    0,
  );
  assert.equal(result.forwarded, true);
  assert.equal(request.status, 'pending');
  assert.equal(request.reviewed_at, undefined);
  assert.equal(request.approval_route.current_approver.id, 'tech');
  assert.equal(request.approval_route.history[0].remark, 'Please check team coverage');
  assert.deepEqual(
    request.approval_route.cc.map((person) => person.id),
    ['cc'],
  );
  assert.deepEqual(store.writes, ['requests']);
  assert.deepEqual([...new Set(store.notifications.map((notice) => notice.id))].sort(), [
    'cc',
    'hr',
    'owner',
    'tech',
  ]);
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 0)).ok, false);
});

test('an assigned employee can forward again and the next person can reject the entire request', async () => {
  const request = await submit();
  actor('hr');
  await reviewRequest(request._id, 'approved', '', 'tech', 0);
  actor('tech');
  assert.equal(
    (await reviewRequest(request._id, 'approved', 'Final check', 'cc', 1)).forwarded,
    true,
  );
  actor('cc');
  assert.equal(
    (await reviewRequest(request._id, 'rejected', 'Coverage unavailable', undefined, 2)).ok,
    true,
  );
  assert.equal(request.status, 'rejected');
  assert.equal(request.approval_route.history.length, 3);
  assert.equal(request.reviewed_by, 'cc');
  assert.equal(store.rows.attendance_days.length, 0);
  assert.equal(String(store.rows.leave_balances[0].balance), '10');
});

test('final approval by a tagged employee applies attendance and paid leave once', async () => {
  const data = form('tech');
  data.set('leave_kind', 'PL');
  assert.equal((await createRequest(data)).ok, true);
  const request = store.rows.requests[0];
  actor('tech');
  const result = await reviewRequest(request._id, 'approved', 'Approved', undefined, 0);
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
  assert.equal(String(store.rows.leave_balances[0].balance), '9');
  assert.equal(store.rows.attendance_days[0].status, 'L');
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 0)).ok, false);
  assert.equal(String(store.rows.leave_balances[0].balance), '9');
  assert.equal(store.rows.attendance_days.length, 1);
});

test('invalid forwarding, stale tabs, and a concurrent cancellation cannot save a decision', async () => {
  const request = await submit();
  actor('hr');
  for (const id of ['owner', 'hr', 'missing']) {
    assert.equal((await reviewRequest(request._id, 'approved', '', id, 0)).ok, false);
  }
  assert.equal((await reviewRequest(request._id, 'rejected', '', 'tech', 0)).ok, false);
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 99)).ok, false);
  store.beforeDecision = () => {
    request.status = 'cancelled';
  };
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 0)).ok, false);
  assert.equal(request.approval_route.history.length, 0);
  assert.equal(store.rows.attendance_days.length, 0);
});

test('failed storage leaves the assignment and history unchanged', async () => {
  const request = await submit();
  actor('hr');
  store.failDecision = true;
  assert.equal((await reviewRequest(request._id, 'approved', '', 'tech', 0)).ok, false);
  assert.equal(request.status, 'pending');
  assert.equal(request.approval_route.current_approver.id, 'hr');
  assert.equal(request.approval_route.history.length, 0);
});

test('applicant cancellation notifies recipients and prevents later approval', async () => {
  const request = await submit();
  assert.equal((await cancelRequest(request._id)).ok, true);
  assert.equal(request.status, 'cancelled');
  assert.deepEqual(store.notifications.map((notice) => notice.id).sort(), ['cc', 'hr']);
  actor('hr');
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 0)).ok, false);
});

test('comp-off routing reserves a credit but consumes it only after final approval', async () => {
  const data = form();
  data.set('take_date', '2026-09-21');
  assert.equal((await applyCompOff(data)).ok, true);
  const request = store.rows.requests[0];
  assert.equal(store.rows.comp_offs[0].status, 'applied');
  actor('hr');
  assert.equal((await reviewRequest(request._id, 'approved', '', 'tech', 0)).forwarded, true);
  assert.equal(store.rows.comp_offs[0].status, 'applied');
  actor('tech');
  assert.equal((await reviewRequest(request._id, 'approved', '', undefined, 1)).ok, true);
  assert.equal(store.rows.comp_offs[0].status, 'used');
  assert.equal(store.rows.attendance_days[0].status, 'CO');
});

test('legacy unassigned requests retain staff review and can enter the forwarding workflow', async () => {
  const request = await submit();
  delete request.approval_route;
  actor('hr');
  assert.deepEqual(await reviewRoutedRequest(request._id, 'approved', null), { kind: 'legacy' });
  assert.equal((await reviewRequest(request._id, 'approved', '', 'tech')).forwarded, true);
  actor('tech');
  assert.equal((await reviewRequest(request._id, 'rejected', '', undefined, 1)).ok, true);
});

test('CC limits and applicant identity are validated before persistence', async () => {
  await assert.rejects(
    prepareRequestRouting(
      form(
        'hr',
        Array.from({ length: 21 }, (_, index) => `cc-${index}`),
      ),
      'e-owner',
    ),
    /at most 20/,
  );
  store.rows.employees.find((employee) => employee._id === 'e-owner').status = 'inactive';
  assert.equal((await createRequest(form())).ok, false);
  assert.equal(store.rows.requests.length, 0);
});
