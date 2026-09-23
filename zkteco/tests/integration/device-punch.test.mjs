import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { Decimal128 } from 'mongodb';
import { databaseFixture } from '../../../tests/integration/database-fixture.mjs';

let fixture;
let database;
let system;
let recordDevicePunch;
let recordPunch;
let readPunchStatus;
let employeeId;
let user;
let localParts;

before(async () => {
  fixture = await databaseFixture();
  database = fixture.database;
  ({ recordDevicePunch } = await import('../../server/ingest.ts'));
  ({ recordPunch, readPunchStatus, localParts } = await import('../../../src/lib/punch.ts'));
  const { createQueryClient } = await import('../../../src/lib/db/query-client.ts');
  system = createQueryClient(true);
});

after(async () => fixture?.close());

async function save(query) {
  const result = await query;
  assert.equal(result.error, null, JSON.stringify(result.error));
}

beforeEach(async () => {
  await fixture.reset();
  process.env.ZKTECO_PUNCH_MODE = 'toggle';
  process.env.ZKTECO_DEBOUNCE_SECONDS = '0';
  employeeId = randomUUID();
  const branchId = randomUUID();
  await save(
    system.from('branches').insert({ _id: branchId, name: 'Device test', state: 'Maharashtra' }),
  );
  await save(
    system.from('employees').insert({
      _id: employeeId,
      code: 'DX007',
      full_name: 'Device test employee',
      branch_id: branchId,
      gender: 'Male',
      date_of_joining: '2026-01-01',
      status: 'active',
      gross_monthly: Decimal128.fromString('0'),
      basic_da: Decimal128.fromString('0'),
      hra: Decimal128.fromString('0'),
      special_allowance: Decimal128.fromString('0'),
    }),
  );
  await save(system.from('settings').insert({ key: 'punch_require_location', value: false }));
  user = {
    _id: randomUUID(),
    email: 'device-test@example.invalid',
    full_name: 'Device test employee',
    employee_id: employeeId,
    branch_id: branchId,
    role: 'employee',
    disabled: false,
    password_hash: 'unused-test-hash',
    token_version: 1,
    tab_access: {},
    avatar: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  await database.collection('users').insertOne(user);
  await database.collection('attendance_devices').insertOne({
    _id: 'test-terminal',
    serial_number: 'test-serial',
    enabled: true,
    branch_id: branchId,
    latitude: null,
    longitude: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await database.collection('device_employee_links').insertOne({
    _id: 'test-terminal:7',
    device_id: 'test-terminal',
    serial_number: 'test-serial',
    device_uid: '7',
    employee_id: employeeId,
    user_ids: ['DX007'],
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

function scan(timestamp, overrides = {}) {
  return {
    deviceId: 'test-terminal',
    uid: '7',
    userId: 'DX007',
    timestamp: timestamp.replace('2026-09-28', localParts().date),
    punch: 0,
    status: 1,
    ...overrides,
  };
}

test('device sessions share totals and retry concurrently without duplicate attendance', async () => {
  const first = scan('2026-09-28T03:30:00.000Z');
  const responses = await Promise.all([recordDevicePunch(first), recordDevicePunch(first)]);
  assert.equal(responses.filter((result) => !result.duplicate).length, 1);
  await recordDevicePunch(scan('2026-09-28T04:30:00.000Z'));
  const day = await database.collection('attendance_days').findOne({ employee_id: employeeId });
  assert.equal(day.punch_in, '09:00');
  assert.equal(day.punch_out, '10:00');
  assert.equal(day.worked_minutes, 60);
  assert.equal(await database.collection('punch_events').countDocuments(), 2);
  assert.equal(await database.collection('device_punch_receipts').countDocuments(), 2);
  assert.equal((await database.collection('device_punch_receipts').findOne()).raw.status, 1);
});

test('rejected summary rolls back device event and receipt, allowing a successful retry', async () => {
  const first = scan('2026-09-28T03:30:00.000Z');
  await fixture.rejectDocuments(
    'attendance_days',
    { employee_id: { $ne: employeeId } },
    async () => {
      await assert.rejects(recordDevicePunch(first));
    },
  );
  assert.equal(await database.collection('punch_events').countDocuments(), 0);
  assert.equal(await database.collection('device_punch_receipts').countDocuments(), 0);
  assert.equal((await recordDevicePunch(first)).status, 'recorded');
});

test('device-to-web and web-to-device work in the same day', async () => {
  const date = localParts().date;
  await recordDevicePunch(scan(new Date(`${date}T00:00:00+05:30`).toISOString()));
  const out = await fixture.asUser(user, () => recordPunch('out', null));
  assert.equal(out.kind, 'out');
  const next = await recordDevicePunch(
    scan(new Date(new Date(out.punchedAt).getTime() + 2000).toISOString()),
  );
  assert.equal(next.kind, 'in');
  const kinds = await database.collection('punch_events').find().sort({ punched_at: 1 }).toArray();
  assert.deepEqual(
    kinds.map((row) => row.source),
    ['zkteco', 'web_app', 'zkteco'],
  );
});

test('simultaneous initial web and device punches do not open two sessions', async () => {
  process.env.ZKTECO_DEBOUNCE_SECONDS = '60';
  const results = await Promise.allSettled([
    fixture.asUser(user, () => recordPunch('in', null)),
    recordDevicePunch(scan(new Date().toISOString())),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.equal(await database.collection('punch_events').countDocuments(), 1);
});

test('delayed and repeated scans are retained without altering accepted attendance', async () => {
  process.env.ZKTECO_DEBOUNCE_SECONDS = '60';
  await recordDevicePunch(scan('2026-09-28T03:30:00.000Z'));
  assert.equal((await recordDevicePunch(scan('2026-09-28T03:30:10.000Z'))).status, 'ignored');
  assert.equal((await recordDevicePunch(scan('2026-09-28T03:29:00.000Z'))).status, 'needs_review');
  assert.equal(await database.collection('punch_events').countDocuments(), 1);
  assert.equal(await database.collection('device_punch_receipts').countDocuments(), 3);
});

test('unmapped employees stay retryable, direction conflicts cannot fabricate work', async () => {
  await assert.rejects(recordDevicePunch(scan('2026-09-28T03:30:00.000Z', { userId: 'UNKNOWN' })));
  assert.equal(await database.collection('device_punch_receipts').countDocuments(), 0);
  process.env.ZKTECO_PUNCH_MODE = 'device';
  assert.equal(
    (await recordDevicePunch(scan('2026-09-28T03:30:00.000Z', { punch: 1 }))).status,
    'needs_review',
  );
  assert.equal(await database.collection('punch_events').countDocuments(), 0);
});

test('attendance packet UID differs from enrollment UID without changing employee or retry identity', async () => {
  const event = scan('2026-09-28T03:30:00.000Z', { uid: '2054' });
  const first = await recordDevicePunch(event);
  assert.equal(first.status, 'recorded');
  assert.equal((await recordDevicePunch(event)).duplicate, true);
  const punch = await database.collection('punch_events').findOne();
  assert.equal(punch.employee_id, employeeId);
  assert.equal(punch.device_uid, '7');
  assert.equal(punch.device_attendance_uid, '2054');
  assert.equal(await database.collection('punch_events').countDocuments(), 1);
});

test('ambiguous terminal user IDs stay queued rather than selecting an arbitrary employee', async () => {
  await database.collection('device_employee_links').insertOne({
    _id: 'test-terminal:8',
    device_id: 'test-terminal',
    serial_number: 'test-serial',
    device_uid: '8',
    employee_id: randomUUID(),
    user_ids: ['DX007'],
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await assert.rejects(recordDevicePunch(scan('2026-09-28T03:30:00.000Z')));
  assert.equal(await database.collection('punch_events').countDocuments(), 0);
  assert.equal(await database.collection('device_punch_receipts').countDocuments(), 0);
});

test('existing HR-set status survives device attendance and location remains unknown', async () => {
  await save(
    system.from('attendance_days').insert({
      employee_id: employeeId,
      work_date: localParts().date,
      status: 'WO',
      worked_minutes: 0,
    }),
  );
  await recordDevicePunch(scan('2026-09-28T03:30:00.000Z'));
  assert.equal((await database.collection('attendance_days').findOne()).status, 'WO');
  assert.equal((await database.collection('punch_events').findOne()).within_geofence, null);
});

test('ZKTeco-only access blocks both direct web writes before location checks, while device attendance remains available', async () => {
  await database
    .collection('users')
    .updateOne({ _id: user._id }, { $set: { punch_access: 'zkteco' } });
  await database
    .collection('settings')
    .updateOne({ key: 'punch_require_location' }, { $set: { value: true } });
  await database
    .collection('attendance_devices')
    .updateOne({ _id: 'test-terminal' }, { $set: { latitude: 18.559, longitude: 73.7868 } });
  const status = await fixture.asUser(user, () => readPunchStatus());
  assert.equal(status.punchAccess, 'zkteco');
  assert.equal(status.requireLocation, true);
  await assert.rejects(
    fixture.asUser(user, () => recordPunch('in', null)),
    /Web punching is disabled/,
  );
  assert.equal((await recordDevicePunch(scan('2026-09-28T03:30:00.000Z'))).status, 'recorded');
  await assert.rejects(
    fixture.asUser(user, () => recordPunch('out', null)),
    /Web punching is disabled/,
  );
  const events = await database.collection('punch_events').find().toArray();
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'zkteco');
});

test('web-only access acknowledges refused scans without attendance and does not replay them after access changes', async () => {
  await database
    .collection('users')
    .updateOne({ _id: user._id }, { $set: { punch_access: 'web' } });
  const event = scan('2026-09-28T03:30:00.000Z');
  const result = await recordDevicePunch(event);
  assert.equal(result.status, 'ignored');
  assert.match(result.reason, /ZKTeco punching is disabled/);
  assert.equal(await database.collection('punch_events').countDocuments(), 0);
  assert.equal(await database.collection('attendance_days').countDocuments(), 0);

  const web = await fixture.asUser(user, () => recordPunch('in', null));
  assert.equal(web.kind, 'in');
  await database
    .collection('users')
    .updateOne({ _id: user._id }, { $set: { punch_access: 'both' } });
  const retry = await recordDevicePunch(event);
  assert.equal(retry.status, 'ignored');
  assert.equal(retry.duplicate, true);
  assert.equal(await database.collection('punch_events').countDocuments(), 1);
  assert.equal((await fixture.asUser(user, () => readPunchStatus())).punchAccess, 'both');
});
