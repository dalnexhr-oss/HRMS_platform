import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceTokenMatches, parseDevicePunch, deviceEventId, devicePunchKind } from '../server/protocol.ts';
import { cleanName } from '../admin/roster/names.mjs';
import { planHrms } from '../admin/roster/plan.mjs';

const scan = {
  deviceId: 'office',
  uid: '7',
  userId: 'DX007',
  timestamp: '2026-09-28T09:30:00+05:30',
  punch: 0,
  status: 1,
};
const now = new Date('2026-09-28T12:00:00Z');

test('device ingestion requires the configured bearer secret', () => {
  const secret = 'a'.repeat(48);
  assert.equal(deviceTokenMatches(`Bearer ${secret}`, secret), true);
  for (const header of [null, secret, 'Bearer short', `Bearer ${'b'.repeat(48)}`]) {
    assert.equal(deviceTokenMatches(header, secret), false);
  }
  assert.equal(deviceTokenMatches('Bearer short', 'short'), false);
  assert.equal(deviceTokenMatches(`Bearer ${secret}`, undefined), false);
});

test('device timestamps preserve IST, reject unknown devices, and exclude extra fields', () => {
  const event = parseDevicePunch({ ...scan, _id: 'injected' }, 'office', now);
  assert.equal(event.timestamp, '2026-09-28T04:00:00.000Z');
  assert.equal(event._id, undefined);
  assert.throws(() =>
    parseDevicePunch({ ...scan, timestamp: '2026-02-30T09:30:00Z' }, 'office', now),
  );
  assert.throws(() => parseDevicePunch(scan, 'other', now));
  assert.throws(() =>
    parseDevicePunch({ ...scan, timestamp: '2026-09-28T09:30:00' }, 'office', now),
  );
  assert.throws(() =>
    parseDevicePunch({ ...scan, timestamp: '2026-09-29T09:30:00Z' }, 'office', now),
  );
  assert.throws(() => parseDevicePunch({ ...scan, userId: { $ne: null } }, 'office', now));
});

test('retry identity survives a renamed employee code', () => {
  const event = parseDevicePunch(scan, 'office', now);
  assert.equal(deviceEventId(event), deviceEventId({ ...event, userId: 'updated-code' }));
  assert.notEqual(deviceEventId(event), deviceEventId({ ...event, uid: '8' }));
});

test('toggle and explicit device directions support mixed web/device sessions', () => {
  assert.equal(devicePunchKind(0, 'toggle'), 'in');
  assert.equal(devicePunchKind(0, 'toggle', 'in'), 'out');
  assert.equal(devicePunchKind(0, 'toggle', 'out'), 'in');
  for (const code of [0, 3, 4]) {
    assert.equal(devicePunchKind(code, 'device'), 'in');
  }
  for (const code of [1, 2, 5]) {
    assert.equal(devicePunchKind(code, 'device'), 'out');
  }
  assert.throws(() => devicePunchKind(255, 'device'));
  assert.throws(() => devicePunchKind(0, 'invalid'));
});

test('roster cleans the DOB annotation without losing names and refuses ambiguous HRMS matches', () => {
  assert.equal(cleanName(' Person Name (on paper DOB - 03/03/1998) '), 'Person Name');
  const roster = [{ userId: 'DX007', name: 'Person Name', designation: 'Engineer' }];
  const existing = [{ _id: 'a', code: 'old', full_name: 'Person Name' }];
  assert.equal(planHrms(roster, existing)[0].employeeId, 'a');
  assert.equal(planHrms(roster, [])[0].action, 'missing');
  assert.equal(
    planHrms(roster, [...existing, { _id: 'b', code: 'DX007', full_name: 'Other Person' }])[0]
      .action,
    'conflict',
  );
});
