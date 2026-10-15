import 'server-only';
import { db } from '@/lib/db/mongodb-connection';
import { transactionSession } from '@/lib/db/transaction-context';
import { monthSealReason, periodMonthFor } from '@/lib/payroll/payroll-month';
import type { ClientSession, Document } from 'mongodb';
import type { PayrollRunSeal } from '@/lib/payroll/payroll-month';

/** A real shared write prevents snapshot write skew, including periods with no payroll run yet. */
async function reserveWrite(key: string, session = transactionSession()): Promise<void> {
  if (!session?.inTransaction()) {
    throw new Error('This write requires a database transaction.');
  }
  try {
    await (
      await db()
    )
      .collection<Document & { _id: string }>('_write_reservations')
      .updateOne({ _id: key }, { $inc: { revision: 1 } }, { upsert: true, session });
  } catch (error) {
    // Two first users can race to create the same lock. Retry the entire transaction, never a
    // statement in an already aborted transaction.
    const conflict = error as { code?: number; addErrorLabel?: (label: string) => void };
    if (conflict.code === 11000) {
      conflict.addErrorLabel?.('TransientTransactionError');
    }
    throw error;
  }
}

async function reservePayrollPeriod(
  periodMonth: string,
  session = transactionSession(),
): Promise<void> {
  await reserveWrite(`payroll:${periodMonthFor(periodMonth)}`, session);
}

async function reserveAttendanceMonth(
  workDate: string,
  session = transactionSession(),
): Promise<void> {
  const periodMonth = periodMonthFor(workDate);
  await reservePayrollPeriod(periodMonth, session);
  const run = await (
    await db()
  )
    .collection<Document & PayrollRunSeal>('payroll_runs')
    .findOne({ period_month: periodMonth }, { session });
  const reason = monthSealReason(periodMonth, run);
  if (reason) {
    throw new Error(reason);
  }
}

async function reserveOpenRun(runId: string, session = transactionSession()): Promise<void> {
  const runs = (await db()).collection<Document & { _id: string }>('payroll_runs');
  const run = await runs.findOne({ _id: runId }, { session });
  if (!run) {
    throw new Error('That payroll run no longer exists.');
  }
  await reservePayrollPeriod(String(run.period_month), session);
  const result = await runs.updateOne(
    { _id: runId, status: { $in: ['draft', 'in_review'] } },
    { $inc: { calculation_revision: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw new Error('Payroll run is locked, paid, or missing. No changes were saved.');
  }
}

export { reserveWrite, reservePayrollPeriod, reserveAttendanceMonth, reserveOpenRun };
