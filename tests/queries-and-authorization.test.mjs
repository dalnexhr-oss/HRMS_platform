import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './helpers/load-typescript.mjs';

test('helpdesk comments are limited to visible parent tickets', async () => {
  const queries = [];
  const { getTicketComments } = loadTypeScript('src/lib/queries/helpdesk.ts', {
    '@/lib/db/server-client': {},
    '@/lib/db/collection-registry': {
      collections: { helpdeskTickets: 'tickets', helpdeskTicketComments: 'comments' },
    },
    '@/lib/db/scoped-repository': {
      scoped: async () => ({ find: async () => [{ _id: 'allowed' }] }),
      afterParentCheck: () => ({
        find: async (filter) => {
          queries.push(filter);
          return [
            {
              _id: 'comment',
              ticket_id: 'allowed',
              body: 'Staff reply',
              author_is_staff: true,
              created_at: new Date('2026-09-01T10:00:00Z'),
            },
          ];
        },
      }),
    },
  });
  const result = await getTicketComments(['allowed', 'denied']);
  assert.deepEqual(queries, [{ ticket_id: { $in: ['allowed'] } }]);
  assert.deepEqual(Object.keys(result), ['allowed']);
  assert.equal(result.allowed[0].createdAt, '2026-09-01T10:00:00.000Z');
  assert.equal(result.allowed[0].authorIsStaff, true);
});

test('inaccessible parent tickets never trigger comment access', async () => {
  const { getTicketComments } = loadTypeScript('src/lib/queries/helpdesk.ts', {
    '@/lib/db/server-client': {},
    '@/lib/db/collection-registry': { collections: { helpdeskTickets: 'tickets' } },
    '@/lib/db/scoped-repository': {
      scoped: async () => ({ find: async () => [] }),
      afterParentCheck: () => assert.fail('Unauthorized comment read'),
    },
  });
  assert.deepEqual(await getTicketComments(['denied']), {});
  assert.deepEqual(await getTicketComments([]), {});
});

test('query failures remain distinguishable from an empty employee list', async () => {
  const denied = new Error('Access denied');
  const { getEmployees } = loadTypeScript('src/lib/queries/employees.ts', {
    '@/lib/db/server-client': {},
    '@/lib/db/collection-registry': { collections: {} },
    '@/lib/db/scoped-repository': {
      scoped: async () => ({
        find: async () => {
          throw denied;
        },
      }),
    },
  });
  await assert.rejects(getEmployees(), (error) => error === denied);
});

function requestAction(overrides) {
  const denyDatabase = () => assert.fail('Unauthorized write or service access');
  return loadTypeScript('src/lib/actions/requests.ts', {
    'next/cache': { revalidatePath: () => assert.fail('Denied action revalidated a page') },
    '@/lib/db/server-client': {
      createClient: async () => ({ from: denyDatabase }),
      createServiceClient: denyDatabase,
    },
    '@/lib/db/mongodb-connection': { isMongoConfigured: () => true },
    '@/lib/server-auth': {},
    '@/lib/actions/guards': { requireStaff: async () => ({ ok: false, error: 'Staff only' }) },
    '@/lib/requests/routing': { reviewRoutedRequest: async () => ({ kind: 'legacy' }) },
    '@/lib/requests/leave-attendance': { stampLeaveOnRegister: denyDatabase },
    '@/lib/compensatory-off-settlement': {},
    '@/lib/notification-delivery': {},
    ...overrides,
  });
}

test('denied legacy request decisions do not reach writes or follow-up workflows', async () => {
  const { reviewRequest } = requestAction({});
  assert.deepEqual(await reviewRequest('request', 'approved'), { ok: false, error: 'Staff only' });
});

test('routed authorization failures never obtain a privileged client', async () => {
  const { reviewRequest } = requestAction({
    '@/lib/requests/routing': {
      reviewRoutedRequest: async () => {
        throw new Error('Not the assigned approver');
      },
    },
  });
  assert.deepEqual(await reviewRequest('request', 'approved'), {
    ok: false,
    error: 'Not the assigned approver',
  });
});
