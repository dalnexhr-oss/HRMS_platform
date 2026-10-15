import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db/mongodb-connection';
import { transactionSession } from '@/lib/db/transaction-context';
import { reserveWrite } from '@/lib/db/write-reservations';
import { fromPaise, toPaise } from '@/lib/db/decimal-conversions';
import type { Document } from 'mongodb';

type Stored = Document & { _id: string };

async function settlementContext(exitCaseId: string) {
  const database = await db();
  const session = transactionSession();
  if (!session) {
    throw new Error('Settlement changes require a transaction.');
  }
  const exit = await database
    .collection<Stored>('exit_cases')
    .findOne({ _id: exitCaseId }, { session });
  if (!exit) {
    throw new Error('That exit case no longer exists.');
  }
  await reserveWrite(`settlement:${exit.employee_id}`, session);
  const settlements = database.collection<Stored>('full_and_final');
  const existing = await settlements.findOne({ exit_case_id: exitCaseId }, { session });
  return { database, session, exit, settlements, existing };
}

async function prepareSettlement(exitCaseId: string, actorId: string): Promise<void> {
  const { database, session, exit, settlements, existing } = await settlementContext(exitCaseId);
  if (existing && existing.status !== 'draft') {
    throw new Error('An approved or paid settlement cannot be prepared again.');
  }
  const id = existing?._id ?? randomUUID();
  const eligibility = {
    employee_id: exit.employee_id,
    status: 'approved',
    paid_at: null,
    payroll_run_id: null,
    $or: [{ settlement_id: null }, { settlement_id: id }],
  };
  const claims = database.collection<Stored>('reimbursement_claims');
  const encashments = database.collection<Stored>('leave_encashment');
  const reimbursements = await claims.find(eligibility, { session }).toArray();
  const leave = await encashments.find(eligibility, { session }).toArray();
  const now = new Date();
  for (const [collection, rows] of [
    [claims, reimbursements],
    [encashments, leave],
  ] as const) {
    const ids = rows.map((row) => row._id);
    const reserved = await collection.updateMany(
      { ...eligibility, _id: { $in: ids } },
      { $set: { settlement_id: id, updated_at: now } },
      { session },
    );
    if (reserved.matchedCount !== ids.length) {
      throw new Error('A payment item changed or was reserved elsewhere. Nothing was prepared.');
    }
  }
  const reimbursementPaise = reimbursements.reduce((sum, row) => sum + toPaise(row.amount), 0);
  const leavePaise = leave.reduce((sum, row) => sum + toPaise(row.amount), 0);
  const salary = toPaise(existing?.salary_payable);
  const recovery = toPaise(existing?.asset_recovery);
  const deductions = toPaise(existing?.other_deductions);
  const snapshot = {
    exit_case_id: exitCaseId,
    reimbursement_claim_ids: reimbursements.map((row) => row._id),
    leave_encashment_ids: leave.map((row) => row._id),
    salary_payable: fromPaise(salary),
    leave_encashment: fromPaise(leavePaise),
    pending_reimbursements: fromPaise(reimbursementPaise),
    asset_recovery: fromPaise(recovery),
    other_deductions: fromPaise(deductions),
    net_payable: fromPaise(salary + leavePaise + reimbursementPaise - recovery - deductions),
    status: 'draft',
    prepared_by: actorId,
    updated_at: now,
  };
  if (existing) {
    const saved = await settlements.updateOne(
      { _id: id, status: 'draft' },
      { $set: snapshot },
      { session },
    );
    if (saved.matchedCount !== 1) {
      throw new Error('The settlement changed. Nothing was prepared.');
    }
  } else {
    await settlements.insertOne({ _id: id, ...snapshot, created_at: now }, { session });
  }
}

async function transitionSettlement(
  exitCaseId: string,
  status: 'approved' | 'paid',
  actorId: string,
): Promise<void> {
  if (status !== 'approved' && status !== 'paid') {
    throw new Error('Choose Approve or Paid.');
  }
  const { database, session, exit, settlements, existing } = await settlementContext(exitCaseId);
  if (!existing) {
    throw new Error('Prepare the settlement first.');
  }
  // A repeated acknowledgement of a committed payment never consumes its source rows twice.
  if (existing.status === status) {
    return;
  }
  const from = status === 'approved' ? 'draft' : 'approved';
  if (existing.status !== from) {
    throw new Error(`Only a ${from} settlement can be marked ${status}.`);
  }
  if (
    !Array.isArray(existing.reimbursement_claim_ids) ||
    !Array.isArray(existing.leave_encashment_ids)
  ) {
    throw new Error(
      'This older settlement has no payment item snapshot. Reconcile its items before approving or paying it.',
    );
  }
  const now = new Date();
  for (const [name, ids, expectedAmount] of [
    ['reimbursement_claims', existing.reimbursement_claim_ids, existing.pending_reimbursements],
    ['leave_encashment', existing.leave_encashment_ids, existing.leave_encashment],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      throw new Error('A settlement cannot include a payment item twice.');
    }
    const collection = database.collection<Stored>(name);
    const filter = {
      _id: { $in: ids },
      employee_id: exit.employee_id,
      settlement_id: existing._id,
      status: 'approved',
      paid_at: null,
      payroll_run_id: null,
    };
    const rows = await collection.find(filter, { session }).toArray();
    if (
      rows.length !== ids.length ||
      rows.reduce((sum, row) => sum + toPaise(row.amount), 0) !== toPaise(expectedAmount)
    ) {
      throw new Error(
        'A reserved payment item or its amount changed. The settlement was not changed.',
      );
    }
    if (status === 'paid') {
      const paid = await collection.updateMany(
        filter,
        {
          $set: {
            status: 'paid',
            paid_at: now,
            paid_by: actorId,
            payment_ref: `Final settlement ${existing._id}`,
            updated_at: now,
          },
        },
        { session },
      );
      if (paid.matchedCount !== ids.length) {
        throw new Error('A settlement payment item changed. No payment was recorded.');
      }
    }
  }
  const result = await settlements.updateOne(
    { _id: existing._id, status: from },
    {
      $set:
        status === 'paid'
          ? { status, paid_at: now, paid_by: actorId, updated_at: now }
          : { status, approved_at: now, approved_by: actorId, updated_at: now },
    },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw new Error('The settlement changed. No payment was recorded.');
  }
}

export { prepareSettlement, transitionSettlement };
