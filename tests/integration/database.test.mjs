import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Decimal128 } from 'mongodb';
import { databaseFixture } from './database-fixture.mjs';

let fixture;
let db;
let system;
let payroll;
let payrollActions;
let passwords;
let tokens;
let hashing;
let recordPunch;
let upload;
let employeeId;
let noticeId;
let inactiveId;
let branchId;
let runId;
let user;
let initialHash;
const point = { latitude: 0, longitude: 0 };
const initialPassword = 'Integration-Initial-Password';
const changedPassword = 'Integration-Changed-Password';
const decimal = (value) => Decimal128.fromString(String(value));

before(async () => {
  fixture = await databaseFixture();
  db = fixture.database;
  const { createSystemQueryClient } = await import('../../src/lib/db/query-client.ts');
  system = createSystemQueryClient();
  payroll = await import('../../src/lib/db/payroll.ts');
  payrollActions = await import('../../src/lib/actions/payroll.ts');
  hashing = await import('../../src/lib/auth/password.ts');
  passwords = await import('../../src/lib/actions/password.ts');
  tokens = await import('../../src/lib/auth/reset-tokens.ts');
  ({ recordPunch } = await import('../../src/lib/punch.ts'));
  ({ POST: upload } = await import('../../src/app/api/documents/upload/route.ts'));
  initialHash = await hashing.hashPassword(initialPassword);
});

after(async () => fixture?.close());

async function save(query) {
  const result = await query;
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.data;
}

function employee(id, code, status) {
  return {
    _id: id,
    code,
    full_name: 'Temporary integration test',
    branch_id: branchId,
    gender: 'Male',
    date_of_joining: '2026-01-01',
    status,
    gross_monthly: decimal(30000),
    basic_da: decimal(15000),
    hra: decimal(10000),
    special_allowance: decimal(5000),
  };
}

beforeEach(async () => {
  await fixture.reset();
  [employeeId, noticeId, inactiveId, branchId, runId] = Array.from({ length: 5 }, () =>
    randomUUID(),
  );
  await save(
    system
      .from('branches')
      .insert({ _id: branchId, name: 'Integration branch', state: 'Maharashtra' }),
  );
  await save(
    system
      .from('employees')
      .insert([
        employee(employeeId, 'TEST-ACTIVE', 'active'),
        employee(noticeId, 'TEST-NOTICE', 'on_notice'),
        employee(inactiveId, 'TEST-INACTIVE', 'inactive'),
      ]),
  );
  await save(
    system.from('payroll_runs').insert({ _id: runId, period_month: '2026-09-01', status: 'draft' }),
  );
  user = {
    _id: randomUUID(),
    email: 'integration@example.invalid',
    full_name: 'Integration user',
    employee_id: employeeId,
    branch_id: branchId,
    role: 'employee',
    disabled: false,
    password_hash: initialHash,
    token_version: 1,
    tab_access: {},
    avatar: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  await db.collection('users').insertOne(user);
});

async function monthAttendance(ids = [employeeId]) {
  await save(
    system.from('attendance_days').insert(
      ids.flatMap((id) =>
        Array.from({ length: 30 }, (_, i) => ({
          employee_id: id,
          work_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
          status: 'P',
          worked_minutes: 555,
        })),
      ),
    ),
  );
}

test('paid comp-off, holidays, and week offs retain pay without requiring punch hours', async () => {
  await monthAttendance();
  const before = await payroll.computePayslip(employeeId, runId);
  for (const [i, status] of ['CO', 'OH', 'WO'].entries()) {
    await db
      .collection('attendance_days')
      .updateOne(
        { employee_id: employeeId, work_date: `2026-09-0${i + 1}` },
        { $set: { status, worked_minutes: 0 } },
      );
  }
  const after = await payroll.computePayslip(employeeId, runId);
  assert.equal(after.payable_days, 30);
  assert.equal(after.target_minutes, 27 * 555);
  assert.equal(after.shortfall_amount, 0);
  assert.equal(after.net_payable, before.net_payable);
  const saved = await db.collection('payslips').findOne({ employee_id: employeeId });
  assert.equal(Number(saved.shortfall_amount.toString()), 0);
});

test('worked-day shortfalls still reduce pay', async () => {
  await monthAttendance();
  await db
    .collection('attendance_days')
    .updateOne(
      { employee_id: employeeId, work_date: '2026-09-01' },
      { $set: { worked_minutes: 0 } },
    );
  const result = await payroll.computePayslip(employeeId, runId);
  assert.equal(result.shortfall_minutes, 555);
  assert.equal(result.shortfall_amount, 100000);
});

test('payroll includes on-notice employees and excludes inactive employees', async () => {
  await monthAttendance([employeeId, noticeId, inactiveId]);
  await payroll.computeRun(runId);
  const slips = await db.collection('payslips').find({ payroll_run_id: runId }).toArray();
  assert.deepEqual(slips.map((slip) => slip.employee_id).sort(), [employeeId, noticeId].sort());
});

test('a failed batch rolls back every payslip and the run transition', async () => {
  await monthAttendance([employeeId, noticeId]);
  await fixture.rejectDocuments('payslips', { employee_id: { $ne: noticeId } }, async () => {
    await assert.rejects(payroll.computeRun(runId), /validation/i);
  });
  assert.equal(await db.collection('payslips').countDocuments(), 0);
  assert.equal((await db.collection('payroll_runs').findOne({ _id: runId })).status, 'draft');
});

test('locking waits for a complete recomputation and no payslip writes follow the lock', async () => {
  const extra = Array.from({ length: 23 }, (_, i) =>
    employee(randomUUID(), `TEST-RACE-${i}`, 'active'),
  );
  await save(system.from('employees').insert(extra));
  await monthAttendance([employeeId, noticeId, ...extra.map((e) => e._id)]);
  await payroll.computeRun(runId);
  await db
    .collection('employees')
    .updateMany({}, { $set: { gross_monthly: decimal(31000), special_allowance: decimal(6000) } });
  let started;
  let locked = false;
  let laterWrites = 0;
  const firstWrite = new Promise((resolve) => {
    started = resolve;
  });
  const observe = (event) => {
    if (event.commandName === 'update' && event.command.update === 'payslips') {
      started();
      if (locked) {
        laterWrites++;
      }
    }
  };
  fixture.client.on('commandStarted', observe);
  const computation = payroll.computeRun(runId);
  try {
    await Promise.race([
      firstWrite,
      computation.then(() => {
        throw new Error('No payslip write observed');
      }),
    ]);
    await payroll.lockRun(runId);
    locked = true;
    await computation;
  } finally {
    await computation.catch(() => undefined);
    fixture.client.off('commandStarted', observe);
  }
  assert.equal(laterWrites, 0);
  assert.equal((await db.collection('payroll_runs').findOne({ _id: runId })).status, 'locked');
  const slips = await db.collection('payslips').find({ payroll_run_id: runId }).toArray();
  assert.equal(slips.length, 25);
  assert.ok(
    slips.every(
      (slip) => slip.status === 'generated' && Number(slip.earned_gross.toString()) === 31000,
    ),
  );
});

function adjustments() {
  return Object.fromEntries(
    [
      'advance_recovery',
      'loss_damage',
      'last_month_balance',
      'reimbursement_bonus',
      'other_deductions',
      'bonus',
    ].map((key) => [key, decimal(key === 'bonus' ? 100 : 0)]),
  );
}

test('locked and paid runs reject recomputation and adjustment writes', async () => {
  await monthAttendance();
  await payroll.computeRun(runId);
  const slip = await db.collection('payslips').findOne({ employee_id: employeeId });
  await payroll.lockRun(runId);
  for (const status of ['locked', 'paid']) {
    if (status === 'paid') {
      await payroll.markRunPaid(runId);
    }
    const before = await db.collection('payslips').findOne({ _id: slip._id });
    await assert.rejects(payroll.computeRun(runId), /locked, paid/);
    await assert.rejects(payroll.computePayslip(employeeId, runId), /locked, paid/);
    await assert.rejects(payroll.savePayslipAdjustments(slip._id, adjustments()), /locked, paid/);
    assert.deepEqual(await db.collection('payslips').findOne({ _id: slip._id }), before);
    assert.equal(await db.collection('payslip_adjustments').countDocuments(), 0);
  }
});

test('adjustments and recomputed amounts commit together or both roll back', async () => {
  await monthAttendance();
  await payroll.computeRun(runId);
  const slip = await db.collection('payslips').findOne({ employee_id: employeeId });
  await fixture.rejectDocuments('payslips', { net_payable: slip.net_payable }, async () => {
    await assert.rejects(payroll.savePayslipAdjustments(slip._id, adjustments()), /validation/i);
  });
  assert.equal(await db.collection('payslip_adjustments').countDocuments(), 0);
  await payroll.savePayslipAdjustments(slip._id, adjustments());
  const changed = await db.collection('payslips').findOne({ _id: slip._id });
  assert.equal(Number(changed.net_payable.toString()) - Number(slip.net_payable.toString()), 100);
});

test('the adjustment action checks the role and saves recalculated amounts only on open runs', async () => {
  await monthAttendance();
  await payroll.computeRun(runId);
  const slip = await db.collection('payslips').findOne({ employee_id: employeeId });
  const form = new FormData();
  form.set('payslipId', slip._id);
  form.set('bonus', '125.50');
  const denied = await fixture.asUser(user, () => payrollActions.saveAdjustments(form));
  assert.equal(denied.ok, false);
  assert.equal(await db.collection('payslip_adjustments').countDocuments(), 0);

  await db.collection('users').updateOne({ _id: user._id }, { $set: { role: 'hr' } });
  const staff = { ...user, role: 'hr' };
  const saved = await fixture.asUser(staff, () => payrollActions.saveAdjustments(form));
  assert.deepEqual(saved, { ok: true });
  const adjustment = await db.collection('payslip_adjustments').findOne({ _id: slip._id });
  assert.equal(Number(adjustment.bonus.toString()), 125.5);
  assert.equal(adjustment.updated_by, user._id);
  const changed = await db.collection('payslips').findOne({ _id: slip._id });
  assert.equal(Number(changed.net_payable.toString()) - Number(slip.net_payable.toString()), 126);

  await payroll.lockRun(runId);
  form.set('bonus', '500');
  const locked = await fixture.asUser(staff, () => payrollActions.saveAdjustments(form));
  assert.equal(locked.ok, false);
  assert.deepEqual(
    await db.collection('payslip_adjustments').findOne({ _id: slip._id }),
    adjustment,
  );
});

function passwordForm(password, token) {
  const form = new FormData();
  form.set('password', password);
  form.set('confirm', password);
  if (token) {
    form.set('token', token);
  }
  return form;
}

test('a password change invalidates previously issued reset links', async () => {
  const token = await tokens.createResetToken(user._id);
  assert.equal(await tokens.peekResetToken(token), true);
  const form = passwordForm(changedPassword);
  form.set('current', initialPassword);
  const changed = await fixture.asUser(user, () => passwords.changePassword({}, form));
  assert.equal(changed.done, true);
  assert.equal(await tokens.peekResetToken(token), false);
  const updated = await db.collection('users').findOne({ _id: user._id });
  const rejected = await fixture.asUser(updated, () =>
    passwords.resetPassword({}, passwordForm('Old-Link-New-Password', token)),
  );
  assert.ok(rejected.error);
  assert.equal(
    await hashing.verifyPassword(
      changedPassword,
      (await db.collection('users').findOne({ _id: user._id })).password_hash,
    ),
    true,
  );
});

test('a current reset link changes the password once and invalidates the old session version', async () => {
  const token = await tokens.createResetToken(user._id);
  const form = passwordForm(changedPassword, token);
  const result = await fixture.asUser(user, () => passwords.resetPassword({}, form));
  assert.equal(result.done, true);
  const updated = await db.collection('users').findOne({ _id: user._id });
  assert.equal(updated.token_version, user.token_version + 1);
  assert.equal(await hashing.verifyPassword(changedPassword, updated.password_hash), true);
  assert.equal(await tokens.peekResetToken(token), false);
  assert.equal(await tokens.consumeResetToken(token), null);
});

test('versionless reset links are rejected and consuming a link carries its credential version', async () => {
  const token = await tokens.createResetToken(user._id);
  await db.collection('password_reset_tokens').updateMany({}, { $unset: { token_version: '' } });
  assert.equal(await tokens.peekResetToken(token), false);
  assert.equal(await tokens.consumeResetToken(token), null);
  const fresh = await tokens.createResetToken(user._id);
  assert.deepEqual(await tokens.consumeResetToken(fresh), { userId: user._id, tokenVersion: 1 });
});

test('a rejected punch-out summary rolls back its event and the next attempt succeeds', async () => {
  await fixture.asUser(user, () => recordPunch('in', point));
  await fixture.rejectDocuments('attendance_days', { punch_out: null }, async () => {
    await assert.rejects(
      fixture.asUser(user, () => recordPunch('out', point)),
      /validation/i,
    );
  });
  assert.equal(await db.collection('punch_events').countDocuments({ employee_id: employeeId }), 1);
  await fixture.asUser(user, () => recordPunch('out', point));
  const events = await db
    .collection('punch_events')
    .find({ employee_id: employeeId })
    .sort({ punched_at: 1 })
    .toArray();
  assert.deepEqual(
    events.map((event) => event.kind),
    ['in', 'out'],
  );
  const day = await db.collection('attendance_days').findOne({ employee_id: employeeId });
  assert.ok(day.punch_out);
});

test('a rejected initial punch leaves no partial record and can be retried', async () => {
  await fixture.rejectDocuments('attendance_days', { status: { $ne: 'P' } }, async () => {
    await assert.rejects(
      fixture.asUser(user, () => recordPunch('in', point)),
      /validation/i,
    );
  });
  assert.equal(await db.collection('punch_events').countDocuments(), 0);
  assert.equal(await db.collection('attendance_days').countDocuments(), 0);
  await fixture.asUser(user, () => recordPunch('in', point));
  assert.equal(await db.collection('punch_events').countDocuments(), 1);
});

test('concurrent punch-outs commit only one event and one attendance summary', async () => {
  await fixture.asUser(user, () => recordPunch('in', point));
  const results = await Promise.allSettled([
    fixture.asUser(user, () => recordPunch('out', point)),
    fixture.asUser(user, () => recordPunch('out', point)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await db.collection('punch_events').countDocuments({ kind: 'out' }), 1);
  assert.ok(
    (await db.collection('attendance_days').findOne({ employee_id: employeeId })).punch_out,
  );
});

function uploadRequest() {
  return new Request(
    'http://localhost/api/documents/upload?filename=integration.pdf&category=other',
    {
      method: 'POST',
      body: '%PDF-1.4\n% temporary integration file\n%%EOF',
    },
  );
}

test('failed document registration deletes its GridFS file and chunks', async () => {
  await fixture.rejectDocuments('employee_documents', { category: { $ne: 'other' } }, async () => {
    const response = await fixture.asUser(user, () => upload(uploadRequest()));
    assert.equal(response.status, 500);
  });
  assert.equal(await db.collection('employee_documents').countDocuments(), 0);
  assert.equal(await db.collection('employee_documents.files').countDocuments(), 0);
  assert.equal(await db.collection('employee_documents.chunks').countDocuments(), 0);
});

test('successful document registration retains the file and can be read back', async () => {
  const response = await fixture.asUser(user, () => upload(uploadRequest()));
  assert.equal(response.status, 200, await response.text());
  const doc = await db.collection('employee_documents').findOne({ employee_id: employeeId });
  assert.ok(doc);
  assert.equal(
    await db.collection('employee_documents.files').countDocuments({ filename: doc.storage_path }),
    1,
  );
  const { getObject } = await import('../../src/lib/db/gridfs.ts');
  const file = await fixture.asUser(user, () => getObject('employee-documents', doc.storage_path));
  assert.match(file.bytes.toString(), /^%PDF-1.4/);
});
