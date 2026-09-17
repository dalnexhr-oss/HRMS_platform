/**
 * Scheduled jobs claim a unique (job, run_key) entry in cron_run_log to skip duplicate runs.
 * Release the claim on unexpected failure so the job can retry.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { collections } from '@/lib/db/collections';
import { scopedFor } from '@/lib/db/repo';
import { systemScope } from '@/lib/db/scope';
import { provisionLeaveBalances, scheduled } from '@/lib/db/functions';
import { autoCloseDay, autoPunchOutMinutesFrom, clockToMinutes, minutesToClock } from '@/lib/attendance-rules';
import { monthSealReason, periodMonthFor } from '@/lib/payroll-month';
import { todayIST } from '@/lib/format';
import { noticeRetentionDays } from '@/lib/constants';
import { lastNightSweepNotice } from '@/lib/night-sweep';
import type { BaseDoc } from '@/lib/db/collections';
import type { PayrollRunSeal } from '@/lib/payroll-month';
import type { SweepClosure } from '@/lib/night-sweep';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Claim a unit of work. Returns false if it was already done.
 *
 * Exactly cron_claim(p_job, p_key): insert and let the unique index refuse a
 * repeat. Guard every side-effecting job with this.
 */
export async function cronClaim(job: string, runKey: string, detail?: string): Promise<boolean> {
  const log = scopedFor<BaseDoc>(collections.cronRunLog, systemScope);
  try {
    await log.insertOne({
      _id: randomUUID(),
      job,
      run_key: runKey,
      detail: detail ?? null,
      ran_at: new Date(),
    });
    return true;
  } catch (e) {
    // 11000 = duplicate key violation (job already claimed for this run key).
    if ((e as { code?: number }).code === 11000) {
      return false;
    }
    throw e;
  }
}

/**
 * Release a failed job's claim for retry. Preserve the original job error if releasing the claim
 * also fails.
 */
async function cronRelease(job: string, runKey: string): Promise<void> {
  try {
    const log = scopedFor<BaseDoc>(collections.cronRunLog, systemScope);
    await log.deleteMany({ job, run_key: runKey });
  } catch {
    // swallowed on purpose — see above
  }
}

/**
 * Executes a job under a distributed lock in the cron run log.
 * Acquires claim before starting; on unhandled exception, releases the claim to permit retry.
 */
async function claimed(
  jobName: string,
  ledgerKey: { job: string; runKey: string },
  alreadyRan: string,
  work: () => Promise<{ affected: number; detail?: string }>,
): Promise<JobResult> {
  if (!(await cronClaim(ledgerKey.job, ledgerKey.runKey))) {
    return { job: jobName, ran: false, affected: 0, detail: alreadyRan };
  }
  try {
    const { affected, detail } = await work();
    return { job: jobName, ran: true, affected, ...(detail ? { detail } : {}) };
  } catch (e) {
    await cronRelease(ledgerKey.job, ledgerKey.runKey);
    throw e;
  }
}

export interface JobResult {
  job: string;
  ran: boolean;
  affected: number;
  detail?: string;
}

// purge-old-notices

/**
 * Delete notices older than the shared retention cutoff, using published_at or created_at for
 * drafts. Use separate BSON-date filters for the two cases. Cleanup uses system scope whether
 * triggered by cron or publishing.
 */
export async function deleteExpiredNotices(retentionDays = noticeRetentionDays): Promise<number> {
  const cutoff = new Date(`${addDays(todayIST(), -retentionDays)}T00:00:00Z`);
  const notices = scopedFor<BaseDoc>(collections.notices, systemScope);
  const published = await notices.deleteMany({
    published_at: { $ne: null, $lt: cutoff },
  });
  const drafts = await notices.deleteMany({
    published_at: null,
    created_at: { $lt: cutoff },
  });
  return published + drafts;
}

/** Delete notices that have outlived the retention window. */
export async function purgeOldNotices(retentionDays = noticeRetentionDays): Promise<JobResult> {
  return claimed(
    'purge-old-notices',
    { job: 'purge_old_notices', runKey: todayIST() },
    'already ran today',
    async () => ({ affected: await deleteExpiredNotices(retentionDays) }),
  );
}

// comp-off-expiry

/** Expire comp-offs whose expiry date has passed and that were never used. */
export async function expireCompOffs(): Promise<JobResult> {
  const today = todayIST();
  return claimed(
    'comp-off-expiry',
    { job: 'compoff_expiry', runKey: today },
    'already ran today',
    async () => {
      const compOffs = scopedFor<BaseDoc>(collections.compOffs, systemScope);
      // Only 'available' expires. One already 'applied' is committed to a
      // request, and 'used' has been consumed — expiring either would take
      // back leave the employee has already been granted.
      const affected = await compOffs.updateMany(
        { status: 'available', expires_on: { $ne: null, $lt: today } },
        { $set: { status: 'expired', updated_at: new Date() } },
      );

      if (affected > 0) {
        await logActivity('compoff_expiry', `Expired ${affected} comp-off credit(s)`);
      }
      return { affected };
    },
  );
}

// asset-warranty-reminders

/**
 * Notify staff about assets whose warranty expires within 30 days.
 *
 * Deduplicated per (asset, warranty date) so each asset is flagged once per expiration cycle.
 */
export async function warrantyReminders(): Promise<JobResult> {
  const today = todayIST();
  const horizon = addDays(today, 30);

  const assets = scopedFor<BaseDoc>(collections.assets, systemScope);
  const expiring = await assets.find({
    warranty_upto: { $ne: null, $gte: today, $lte: horizon },
  });

  const recipients = await staffUserIds();
  let notified = 0;

  for (const asset of expiring) {
    const key = `${asset._id}|${asset.warranty_upto}`;
    if (!(await cronClaim('warranty_reminder', key))) {
      continue;
    }
    // Per-item claims need the same rollback as the per-day ones: without it a
    // notification that fails to send marks the asset as reminded for that
    // warranty date, so nobody is ever told about it.
    try {
      await notifyAll(recipients, {
        kind: 'warranty',
        title: 'Asset warranty expiring',

        body: `${asset.desktop_name ?? 'An asset'} is under warranty until ${asset.warranty_upto}.`,
        link: '/assets',
      });
    } catch (e) {
      await cronRelease('warranty_reminder', key);
      throw e;
    }
    notified++;
  }

  return { job: 'asset-warranty-reminders', ran: true, affected: notified };
}

// attendance-auto-punch-out

/**
 * Close yesterday's open days: someone punched in and never punched out.
 *
 * The day is stamped with the configured auto punch-out time and flagged as
 * corrected, so it is visibly a system decision rather than a real punch.
 */
export async function autoPunchOut(targetDate?: string): Promise<JobResult> {
  const date = targetDate ?? addDays(todayIST(), -1);
  return claimed(
    'attendance-auto-punch-out',
    { job: 'auto_punch_out', runKey: date },
    'already ran for ' + date,
    async () => {
      // Respect payroll seals before changing yesterday's attendance, including month-boundary
      // runs. A failed payroll lookup must stop the sweep.
      const periodMonth = periodMonthFor(date);
      const runs = scopedFor<BaseDoc>(collections.payrollRuns, systemScope);
      const run = await runs.findOne({ period_month: periodMonth });
      const sealed = monthSealReason(periodMonth, run as PayrollRunSeal | null);
      if (sealed) {
        return { affected: 0, detail: sealed };
      }

      const settings = scopedFor<BaseDoc>(collections.settings, systemScope);
      const row = await settings.findOne({ key: 'auto_punch_out_time' });
      // Share parsing and defaults with the manual sweep.
      const closeMin = autoPunchOutMinutesFrom(row?.value);
      const closeAt = minutesToClock(closeMin);

      const attendance = scopedFor<BaseDoc>(collections.attendanceDays, systemScope);
      const open = await attendance.find({
        work_date: date,
        punch_in: { $ne: null },
        punch_out: null,
      });

      let closed = 0;
      for (const day of open) {
        // Use the shared night-shift calculation. Leave invalid punch times unchanged for HR to
        // review.
        const result = autoCloseDay(clockToMinutes(day.punch_in), null, closeMin);
        if (!result) {
          continue;
        }
        const closedAt = new Date();
        const matched = await attendance.updateOne(
          { _id: day._id, punch_out: null, updated_at: day.updated_at },
          {
            $set: {
              punch_out: closeAt,
              worked_minutes: result.workedMin,
              is_corrected: true,
              correction_reason: 'Auto punch-out: no closing punch was recorded.',
              corrected_by: null,
              auto_close_source: 'scheduled',
              auto_closed_at: closedAt,
              updated_at: closedAt,
            },
          },
        );
        closed += matched;
      }

      // Revisit saved closures on retry if notification delivery failed after the attendance write.
      const swept = await attendance.find({ work_date: date, auto_close_source: 'scheduled' });
      const users = scopedFor<BaseDoc>(collections.users, systemScope);
      const notifications = scopedFor<BaseDoc>(collections.notifications, systemScope);
      for (const day of swept) {
        const notice = lastNightSweepNotice(day as unknown as SweepClosure);
        if (!notice) {
          continue;
        }
        const recipients = await users.find({ employee_id: day.employee_id, disabled: false });
        for (const recipient of recipients) {
          const notification = {
            _id: `night-sweep:${day._id}:${recipient._id}`,
            recipient_id: recipient._id,
            kind: 'system',
            title: 'Missed punch-out closed by night sweep',
            body: notice.message,
            link: '/me#punch',
            read_at: null,
            created_at: new Date(),
          };
          await notifications.upsertOne(
            { _id: notification._id },
            { $setOnInsert: notification },
            notification,
          );
        }
      }

      if (closed > 0) {
        await logActivity('night_sweep', `Auto punched-out ${closed} open day(s) for ${date}`);
      }
      return { affected: closed };
    },
  );
}

// attendance-auto-close-month

/** Stamp the previous month's payroll run as closed, once the month is over. */
export async function autoCloseMonth(): Promise<JobResult> {
  const today = todayIST();
  const [y, m] = today.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;

  return claimed(
    'attendance-auto-close-month',
    { job: 'auto_close_month', runKey: prev },
    'already closed ' + prev,
    async () => {
      const runs = scopedFor<BaseDoc>(collections.payrollRuns, systemScope);
      // Only a draft closes automatically. A run already in review, locked or
      // paid has been handled by a person, and must not be reopened or
      // re-stamped.
      const affected = await runs.updateMany(
        { period_month: prev, status: 'draft', month_closed_at: null },
        { $set: { month_closed_at: new Date(), updated_at: new Date() } },
      );
      return { affected };
    },
  );
}

// leave-annual-provision

/** Open the current leave year. Idempotent through the ledger and by row. */
export async function leaveAnnualProvision(year?: number): Promise<JobResult> {
  const target = year ?? Number(todayIST().slice(0, 4));
  return claimed(
    'leave-annual-provision',
    { job: 'leave_provision', runKey: String(target) },
    `already provisioned ${target}`,
    // Pass the explicit scheduled-job context; a missing session must never imply system
    // privileges.
    async () => ({ affected: await provisionLeaveBalances({ p_year: target }, scheduled) }),
  );
}

// lifecycle-reminders

/** Nudge staff about exits whose last working day is within a week. */
export async function lifecycleReminders(): Promise<JobResult> {
  const today = todayIST();
  const horizon = addDays(today, 7);

  const exits = scopedFor<BaseDoc>(collections.exitCases, systemScope);
  const due = await exits.find({
    last_working_day: { $ne: null, $gte: today, $lte: horizon },
    stage: { $nin: ['completed', 'cancelled'] },
  });

  const recipients = await staffUserIds();
  let notified = 0;

  for (const exit of due) {
    const key = `${exit._id}|${exit.last_working_day}`;
    if (!(await cronClaim('lifecycle_reminder', key))) {
      continue;
    }
    // See warrantyReminders: give the claim back if the notification fails.
    try {
      await notifyAll(recipients, {
        kind: 'notice',
        title: 'Exit approaching',
        body: `An exit case has a last working day of ${exit.last_working_day}.`,
        link: '/exits',
      });
    } catch (e) {
      await cronRelease('lifecycle_reminder', key);
      throw e;
    }
    notified++;
  }

  return { job: 'lifecycle-reminders', ran: true, affected: notified };
}

// shared helpers

async function staffUserIds(): Promise<string[]> {
  const users = scopedFor<BaseDoc>(collections.users, systemScope);
  const rows = await users.find(
    { role: { $in: ['super_admin', 'admin', 'hr'] }, disabled: false },
    { projection: { _id: 1 } },
  );
  return rows.map((u) => u._id);
}

async function notifyAll(
  recipients: string[],
  n: { kind: string; title: string; body: string; link: string },
): Promise<void> {
  if (recipients.length === 0) {
    return;
  }
  const notifications = scopedFor<BaseDoc>(collections.notifications, systemScope);
  await notifications.insertMany(
    recipients.map((recipient_id) => ({
      _id: randomUUID(),
      recipient_id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      read_at: null,
      created_at: new Date(),
    })) as never[],
  );
}

async function logActivity(eventType: string, message: string): Promise<void> {
  const log = scopedFor<BaseDoc>(collections.activityLog, systemScope);
  await log.insertOne({
    _id: randomUUID(),
    actor_id: null,
    actor_name: null,
    employee_id: null,
    employee_code: null,
    employee_name: null,
    event_type: eventType,
    message,
    metadata: {},
    occurred_at: new Date(),
  });
}

// the schedule

export const jobs = {
  'purge-old-notices': purgeOldNotices,
  'attendance-auto-punch-out': () => autoPunchOut(),
  'attendance-auto-close-month': autoCloseMonth,
  'asset-warranty-reminders': warrantyReminders,
  'comp-off-expiry': expireCompOffs,
  'leave-annual-provision': () => leaveAnnualProvision(),
  'lifecycle-reminders': lifecycleReminders,
} as const;

export type JobName = keyof typeof jobs;

/**
 * Run every daily job.
 *
 * One job failing must not stop the others: they are independent, and a
 * warranty-notification failure has no business preventing the month from
 * closing. Each result carries its own outcome.
 */
export async function runDailyJobs(): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const [name, job] of Object.entries(jobs)) {
    try {
      out.push(await job());
    } catch (e) {
      out.push({
        job: name,
        ran: false,
        affected: 0,
        detail: `failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return out;
}
