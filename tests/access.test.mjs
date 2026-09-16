import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessTab, slugFromPathname, staticallyAllowed } from '../src/lib/access.ts';
import { navItems, pageHeader } from '../src/lib/constants.ts';

test('portal paths resolve to their access-control slugs', () => {
  assert.equal(slugFromPathname('/leave-management'), 'leave-management');
  assert.equal(slugFromPathname('/assets/detail'), 'assets');
  assert.equal(slugFromPathname('/'), '');
});

test('navigation and titles use the canonical leave-management slug', () => {
  assert.ok(navItems.some((item) => item.slug === 'leave-management'));
  assert.ok(!navItems.some((item) => item.slug === 'leaveManagment'));
  assert.equal(pageHeader('leave-management')[0], 'Leave Management');
});

test('saved permissions still apply to the leave-management route', () => {
  for (const role of ['admin', 'hr']) {
    assert.equal(canAccessTab(role, 'leave-management', { leaveManagment: false }), false);
    assert.equal(canAccessTab(role, 'leave-management', { leaveManagment: true }), true);
    assert.equal(canAccessTab(role, 'leave-management', {}), true);
  }
});

test('an explicitly saved canonical permission takes precedence over the legacy value', () => {
  assert.equal(
    canAccessTab('admin', 'leave-management', { 'leave-management': true, leaveManagment: false }),
    true,
  );
  assert.equal(
    canAccessTab('admin', 'leave-management', { 'leave-management': false, leaveManagment: true }),
    false,
  );
});

test('per-account overrides cannot grant leave-management access beyond the role gate', () => {
  for (const role of ['employee', 'intern', null, undefined]) {
    assert.equal(staticallyAllowed(role, 'leave-management'), false);
    assert.equal(canAccessTab(role, 'leave-management', { 'leave-management': true }), false);
  }
});

test('super admins retain access and unrelated tabs keep their existing restrictions', () => {
  assert.equal(canAccessTab('super_admin', 'leave-management', { leaveManagment: false }), true);
  assert.equal(canAccessTab('admin', 'payroll', { payroll: false }), false);
  assert.equal(canAccessTab('admin', 'payroll', { leaveManagment: false }), true);
});
