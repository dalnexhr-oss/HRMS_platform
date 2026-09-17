import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canReviewRequest } from '../src/lib/requests/access.ts';
import { routingView } from '../src/lib/requests/routing-view.ts';

const stubs = {
  'next/navigation': 'export const useRouter = () => ({ refresh() {} });',
  '@/lib/actions/requests':
    'export async function reviewRequest() { throw new Error("Render tests cannot save decisions"); }',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier in stubs
      ? { url: `request-ui:${specifier}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url.startsWith('request-ui:')
      ? { format: 'module', source: stubs[url.slice(11)], shortCircuit: true }
      : nextLoad(url, context);
  },
});

const { RecipientPicker } = await import('../src/components/requests/RecipientPicker.tsx');
const { RequestRecipients } = await import('../src/components/requests/RequestRecipients.tsx');
const { RequestRoutingSummary } =
  await import('../src/components/requests/RequestRoutingSummary.tsx');
const { RequestDecisionControls } =
  await import('../src/components/requests/RequestDecisionControls.tsx');

const person = (id) => ({
  id,
  name: `${id} Person`,
  email: `${id}@company.test`,
  employeeId: `e-${id}`,
  detail: 'Engineering',
});
const people = ['hr', 'tech', 'cc'].map(person);
const route = {
  initial_approver: person('hr'),
  current_approver: person('tech'),
  cc: [person('cc')],
  revision: 1,
  history: [
    {
      approver: person('hr'),
      decision: 'approved',
      decided_at: new Date('2026-09-17T05:00:00Z'),
      remark: 'Check team coverage',
      forwarded_to: person('tech'),
    },
  ],
};
const request = {
  id: 'request-1',
  employeeId: 'e-owner',
  status: 'pending',
  routing: routingView(route),
};
const actor = (id, role = 'employee') => ({ id, role, employeeId: `e-${id}` });

test('To and CC render searchable labelled company-account controls', () => {
  const html = renderToStaticMarkup(createElement(RequestRecipients, { people }));
  assert.match(html, /To · Approver/);
  assert.match(html, />CC</);
  assert.equal((html.match(/role="combobox"/g) ?? []).length, 2);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /Type a name or company email/);
  assert.match(html, /CC recipients can view this request and receive updates/);
});

test('selected email-style tags submit IDs and expose accessible remove buttons', () => {
  const html = renderToStaticMarkup(
    createElement(RecipientPicker, {
      label: 'CC',
      name: 'cc_ids',
      people,
      value: ['tech', 'cc'],
      onChange() {},
      multiple: true,
    }),
  );
  assert.match(html, /type="hidden" name="cc_ids" value="tech"/);
  assert.match(html, /type="hidden" name="cc_ids" value="cc"/);
  assert.match(html, /aria-label="Remove tech Person"/);
  assert.match(html, /title="tech@company.test"/);
});

test('current approver gets approve, reject, and further approval controls', () => {
  const html = renderToStaticMarkup(
    createElement(RequestDecisionControls, { request, actor: actor('tech'), people }),
  );
  assert.match(html, />Approve</);
  assert.match(html, />Reject</);
  assert.match(html, /Send to another person for further approval/);
});

test('CC, prior approver, admin, applicant, and completed requests have no decision controls', () => {
  for (const viewer of [actor('cc'), actor('hr', 'hr'), actor('admin', 'admin'), actor('owner')]) {
    assert.equal(canReviewRequest(request, viewer), false);
    assert.equal(
      renderToStaticMarkup(
        createElement(RequestDecisionControls, { request, actor: viewer, people }),
      ),
      '',
    );
  }
  assert.equal(canReviewRequest({ ...request, status: 'approved' }, actor('tech')), false);
  assert.equal(canReviewRequest({ ...request, routing: null }, actor('hr', 'hr')), true);
});

test('request details identify current approver, CC, and the earlier approval with its note', () => {
  const html = renderToStaticMarkup(
    createElement(RequestRoutingSummary, { routing: request.routing, status: 'pending' }),
  );
  assert.match(html, /Awaiting tech Person/);
  assert.match(html, /cc Person/);
  assert.match(html, /forwarded to tech Person/);
  assert.match(html, /Check team coverage/);
  assert.match(html, /17 Sept 2026|17 Sep 2026/);
  assert.equal(request.routing.history[0].decidedAt, '2026-09-17T05:00:00.000Z');
});
