import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

// Keep the real query client, repository, policies, and actions; isolate storage and sessions.
const stubs = {
  'server-only': '',
  'next/cache': 'export const revalidatePath = () => {};',
  'next/headers': 'export const headers = async () => new Headers();',
  '@/lib/auth/session': 'export const getSessionUser = () => globalThis.queryErrorTest.user;',
  '@/lib/auth': 'export const getSession = () => ({ profile: globalThis.queryErrorTest.profile });',
  '@/lib/db/mongo': `
    export const isMongoConfigured = () => true;
    export const db = () => globalThis.queryErrorTest.database;
    export const withTransaction = (fn) => fn(undefined);
  `,
  '@/lib/notify': `
    export const notifyEveryone = async () => {};
    export const notifyApprovers = async () => { globalThis.queryErrorTest.notifications++; };
  `,
  '@/lib/queries': 'export const purgeExpiredNotices = async () => {};',
  '@/lib/storage': `
    export const uploadSharedFile = () => { throw new Error('Unexpected file upload'); };
    export const signedUrl = () => null;
  `,
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier in stubs
      ? { url: 'query-error-test:' + specifier, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url.startsWith('query-error-test:')
      ? {
          format: 'module',
          source: stubs[url.slice('query-error-test:'.length)],
          shortCircuit: true,
        }
      : nextLoad(url, context);
  },
});

const { createClient } = await import('../src/lib/db/server.ts');
const { registerRpc } = await import('../src/lib/db/query-client.ts');
const { markNoticeRead } = await import('../src/lib/actions/notices.ts');
const { acknowledgePolicy } = await import('../src/lib/actions/policies.ts');
const { acknowledgeDocument } = await import('../src/lib/actions/acknowledge.ts');
const { recordUploadedDocument } = await import('../src/lib/documents/upload.ts');

let fixture;
const employeeId = 'employee-1';
const signature = { kind: 'policy', signedName: 'Example Employee' };
const driverError = (code, message, extra = {}) =>
  Object.assign(new Error(message), { code, ...extra });

beforeEach(() => {
  fixture = {
    user: { _id: 'user-1', employee_id: employeeId, role: 'employee' },
    profile: { id: 'user-1', employee_id: employeeId, role: 'employee' },
    error: null,
    writes: 0,
    notifications: 0,
    database: {
      collection() {
        return {
          async insertMany(docs) {
            fixture.writes++;
            if (fixture.error) {
              throw fixture.error;
            }
            return { insertedCount: docs.length };
          },
          find: () => ({ toArray: async () => [] }),
          aggregate: () => ({ toArray: async () => [] }),
        };
      },
    },
  };
  globalThis.queryErrorTest = fixture;
});

test('duplicate records return an application error code through the real repository', async () => {
  fixture.error = driverError(11000, 'Duplicate key');
  const client = await createClient();
  const result = await client.from('policy_acknowledgements').insert({ employee_id: employeeId });
  assert.equal(result.error.code, 'DUPLICATE_KEY');
  assert.match(result.error.message, /already exists/);
  assert.equal(fixture.writes, 1);
});

test('document validation preserves driver details with an application error code', async () => {
  const details = { failingDocumentId: 'document-1' };
  fixture.error = driverError(121, 'Validation failed', { errInfo: details });
  const client = await createClient();
  const result = await client.from('policy_acknowledgements').insert({ employee_id: employeeId });
  assert.equal(result.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(JSON.parse(result.error.details), details);
});

test('permission refusals reach acknowledgement handlers without writing', async () => {
  const client = await createClient();
  const result = await client
    .from('policy_acknowledgements')
    .insert({ employee_id: 'someone-else' });
  assert.equal(result.error.code, 'PERMISSION_DENIED');

  fixture.profile.employee_id = 'someone-else';
  const policy = await acknowledgePolicy('policy-1');
  assert.equal(policy.ok, false);
  assert.match(policy.error, /database refused the receipt/);
  const document = await acknowledgeDocument(signature);
  assert.equal(document.ok, false);
  assert.match(document.error, /signature was refused/);
  assert.equal(fixture.writes, 0);
});

test('missing sessions return a distinct authentication code', async () => {
  fixture.user = null;
  const client = await createClient();
  const result = await client.from('employees').select();
  assert.equal(result.error.code, 'NOT_SIGNED_IN');
  assert.equal(fixture.writes, 0);
});

test('empty document and view results keep single and optional-single behavior', async () => {
  const client = await createClient();
  for (const name of ['employees', 'v_items']) {
    assert.equal((await client.from(name).select().single()).error.code, 'QUERY_NO_RESULT');
    const optional = await client.from(name).select().maybeSingle();
    assert.equal(optional.error, null);
    assert.equal(optional.data, null);
  }
});

test('duplicate notices and policy receipts stay idempotent while signatures explain the conflict', async () => {
  fixture.error = driverError(11000, 'Duplicate key');
  assert.deepEqual(await markNoticeRead('notice-1'), { ok: true });
  assert.deepEqual(await acknowledgePolicy('policy-1'), { ok: true });
  assert.deepEqual(await acknowledgeDocument(signature), {
    ok: false,
    error: 'You have already signed this document.',
  });
  assert.equal(fixture.writes, 3);
});

test('rejected document uploads show the validation message without sending notifications', async () => {
  fixture.error = driverError(121, 'Validation failed');
  const result = await recordUploadedDocument({
    filer: { id: 'user-1', role: 'employee', fullName: 'Example Employee', employeeId },
    employeeId,
    isStaff: false,
    category: 'identity',
    title: 'Identity document',
    storagePath: `${employeeId}/document.pdf`,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage path did not match the employee/);
  assert.equal(fixture.notifications, 0);
});

test('function errors use the same mapping and unrelated failures are not treated as duplicates', async () => {
  registerRpc('test_duplicate_error', async () => {
    throw driverError(11000, 'Duplicate key');
  });
  const client = await createClient();
  assert.equal((await client.rpc('test_duplicate_error')).error.code, 'DUPLICATE_KEY');

  fixture.error = new Error('Database unavailable');
  assert.deepEqual(await markNoticeRead('notice-1'), { ok: false, error: 'Database unavailable' });
  assert.deepEqual(await acknowledgePolicy('policy-1'), {
    ok: false,
    error: 'Database unavailable',
  });
});
