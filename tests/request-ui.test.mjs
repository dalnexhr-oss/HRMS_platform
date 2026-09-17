import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canReviewRequest } from '../src/lib/requests/access.ts';
import { routingView } from '../src/lib/requests/routing-view.ts';
import { employeeApprovals } from '../src/lib/requests/employee-approvals.ts';

const stubs = {
  'next/link': `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}; export default function Link({ children, ...props }) { return createElement('a', props, children); }`,
  'next/navigation':
    'export const useRouter = () => ({ refresh() {} }); export const usePathname = () => "/me/approvals";',
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
const { EmployeeApprovals } = await import('../src/components/employee/EmployeeApprovals.tsx');
const { EmployeeApprovalSummary } =
  await import('../src/components/employee/EmployeeApprovalSummary.tsx');
const { ApprovalsShortcut } = await import('../src/components/employee/ApprovalsShortcut.tsx');

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

const requestFor = (id, overrides = {}) => ({
  ...request,
  id,
  employeeName: `${id} Applicant`,
  employeeCode: 'EMP-001',
  branch: 'Head office',
  type: 'leave',
  leaveKind: 'PL',
  days: 1,
  startDate: '2026-09-21',
  endDate: '2026-09-21',
  reason: 'Family event',
  createdAt: '2026-09-17T05:00:00.000Z',
  ...overrides,
});
const review = (id, overrides = {}) => ({
  approver: person(id),
  decision: 'approved',
  decidedAt: '2026-09-17T05:00:00.000Z',
  remark: 'Team coverage confirmed',
  forwardedTo: null,
  ...overrides,
});
const routeFor = (current, history = [], cc = []) => ({
  initialApprover: person('hr'),
  currentApprover: person(current),
  history,
  cc,
  revision: history.length,
});

test('employee approvals distinguish personal reviews from pending, copied, and unrelated requests', () => {
  const requests = [
    requestFor('pending', { routing: routeFor('tech') }),
    requestFor('forwarded', {
      routing: routeFor('cc', [review('tech', { forwardedTo: person('cc') })]),
    }),
    requestFor('approved', { status: 'approved', routing: routeFor('tech', [review('tech')]) }),
    requestFor('copied', {
      status: 'approved',
      routing: routeFor('hr', [review('hr')], [person('tech')]),
    }),
    requestFor('unrelated', { routing: routeFor('hr') }),
    requestFor('own', { employeeId: 'e-tech', routing: routeFor('hr') }),
    requestFor('cancelled', { status: 'cancelled', routing: routeFor('tech') }),
    requestFor('legacy', { routing: null }),
  ];
  const groups = employeeApprovals(requests, actor('tech'));
  assert.deepEqual(
    groups.pending.map((r) => r.id),
    ['pending'],
  );
  assert.deepEqual(
    groups.reviewed.map((r) => r.id),
    ['forwarded', 'approved'],
  );
  assert.deepEqual(
    groups.cc.map((r) => r.id),
    ['copied'],
  );
  assert.deepEqual(
    groups.all.map((r) => r.id),
    ['pending', 'forwarded', 'approved', 'copied', 'cancelled'],
  );
});

test('review history survives later rejection, cancellation, and reassignment, ordered by personal review time', () => {
  const requests = [
    requestFor('later-rejected', {
      status: 'rejected',
      routing: routeFor('cc', [
        review('tech'),
        review('cc', { decision: 'rejected', decidedAt: '2026-09-19T05:00:00.000Z' }),
      ]),
    }),
    requestFor('later-cancelled', {
      status: 'cancelled',
      routing: routeFor('cc', [review('tech', { decidedAt: '2026-09-18T05:00:00.000Z' })]),
    }),
    requestFor('returned', {
      routing: routeFor('tech', [review('tech'), review('hr', { forwardedTo: person('tech') })]),
    }),
  ];
  const groups = employeeApprovals(requests, actor('tech'));
  assert.deepEqual(
    groups.reviewed.map((r) => r.id),
    ['later-cancelled', 'later-rejected', 'returned'],
  );
  assert.deepEqual(
    groups.pending.map((r) => r.id),
    ['returned'],
  );
});

test('reviewed screen shows personal decision, note and date alongside the final outcome without decision controls', () => {
  const requests = [
    requestFor('handoff', {
      status: 'rejected',
      routing: routeFor('cc', [
        review('tech', { forwardedTo: person('cc') }),
        review('cc', { decision: 'rejected' }),
      ]),
    }),
  ];
  const html = renderToStaticMarkup(
    createElement(EmployeeApprovals, { requests, actor: actor('tech'), people, view: 'reviewed' }),
  );
  assert.match(html, /Approved this stage &amp; forwarded to cc Person/);
  assert.match(html, /Request: rejected/);
  assert.match(html, /Team coverage confirmed/);
  assert.match(html, /dateTime="2026-09-17T05:00:00.000Z"/i);
  assert.match(html, /href="\/requests\/handoff"/);
  assert.doesNotMatch(html, />Approve<|>Reject<|Rejected by you/);
});

test('employee pending view can approve or reject while CC view only exposes tracking', () => {
  const requests = [
    requestFor('assigned', { routing: routeFor('tech') }),
    requestFor('copied', { routing: routeFor('hr', [], [person('tech')]) }),
  ];
  const render = (view) =>
    renderToStaticMarkup(
      createElement(EmployeeApprovals, { requests, actor: actor('tech'), people, view }),
    );
  const pending = render('pending');
  assert.match(pending, />Approve</);
  assert.match(pending, />Reject</);
  assert.match(pending, /Send to another person for further approval/);
  assert.doesNotMatch(pending, /copied Applicant/);
  const cc = render('cc');
  assert.match(cc, /copied Applicant/);
  assert.doesNotMatch(cc, />Approve<|>Reject<|assigned Applicant/);
});

test('dashboard approvals and navigation remain discoverable with no requests', () => {
  const html = renderToStaticMarkup(
    createElement(EmployeeApprovalSummary, { requests: [], actor: actor('tech') }),
  );
  assert.match(html, /Open approvals/);
  assert.match(html, /href="\/me\/approvals\?view=reviewed"/);
  assert.match(html, /<b>0<\/b> reviewed by you/);
  const approvalLink = renderToStaticMarkup(createElement(ApprovalsShortcut));
  assert.match(approvalLink, /href="\/me\/approvals"/);
  assert.match(approvalLink, /aria-current="page"/);
  assert.match(approvalLink, /aria-label="My approvals"/);
  assert.match(approvalLink, /<svg/);
  assert.doesNotMatch(approvalLink, />Dashboard<|>Approvals</);
  const empty = renderToStaticMarkup(
    createElement(EmployeeApprovals, {
      requests: [],
      actor: actor('tech'),
      people,
      view: 'reviewed',
    }),
  );
  assert.match(empty, /You have not reviewed any requests yet/);
});
