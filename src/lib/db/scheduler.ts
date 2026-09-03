// ============================================================================
// Scheduled jobs. SERVER ONLY — replaces the seven pg_cron jobs.
//
// pg_cron ran inside the database and could call plpgsql directly. There is no
// in-database scheduler here, so the jobs are plain functions invoked by
// whatever fires them: a Node timer in a long-lived server, the host's cron, or
// a platform scheduler hitting /api/cron. The bodies do not care which.
//
// THE IDEMPOTENCY LEDGER IS THE IMPORTANT PART. cron_claim(job, key) inserted
// into a table with `unique (job, run_key)` and returned false on conflict, so
// a job that had already run for a given day did no work and — crucially —
// sent no duplicate notification. The same unique index does the same job here.
//
// That matters more now than it did: pg_cron fired once because there was one
// database. An HTTP-triggered scheduler can fire twice (a retry, two instances,
// a nervous operator refreshing), and without the ledger every retry would
// re-notify everyone.
//
// ONE THING HAD TO BE ADDED. In Postgres the claim and the work were the same
// transaction, so a job that failed rolled its claim back and ran again the
// next day. Here they are separate writes to separate collections, so the
// claim is released explicitly on failure — see claimed() and cronRelease().
// Without that, one bad night meant the job was skipped for ever.
// ============================================================================
import 'server-only';
import { randomUUID } from 'node:crypto';
import { COLLECTIONS, type BaseDoc } from '@/lib/db/collections';
import { scopedFor } from '@/lib/db/repo';
import { SYSTEM_SCOPE } from '@/lib/db/scope';
import { provisionLeaveBalances, SCHEDULED } from '@/lib/db/functions';
import {
  autoCloseDay,
  autoPunchOutMinutesFrom,
  clockToMinutes,
  minutesToClock,
} from '@/lib/attendance-rules';
import { monthSealReason, periodMonthFor, type PayrollRunSeal } from '@/lib/payroll-month';
// Every job's notion of "now" — the company runs on IST — and the app's one
// definition of it. See the note on the same import in pgcompat.ts.
import { todayIST } from '@/lib/format';
import { NOTICE_RETENTION_DAYS } from '@/lib/constants';

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
  const log = scopedFor<BaseDoc>(COLLECTIONS.cronRunLog, SYSTEM_SCOPE);
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
    // 11000 is the unique violation — the SQL caught unique_violation and
    // returned false in exactly the same way.
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
}

/**
 * Give a claim back, so the work can be attempted again.
 *
 * Best-effort by design: this only ever runs on a path that is already
 * failing, and the error the caller is about to see matters more than this
 * one. A claim that cannot be released is a job skipped until tomorrow, which
 * is exactly where we started.
 */
async function cronRelease(job: string, runKey: string): Promise<void> {
  try {
    const log = scopedFor<BaseDoc>(COLLECTIONS.cronRunLog, SYSTEM_SCOPE);
    await log.deleteMany({ job, run_key: runKey });
  } catch {
    // swallowed on purpose — see above
  }
}

/**
 * Claim the work, do it, and HAND THE CLAIM BACK if it throws.
 *
 * The ledger row has to be written first: it is what stops two schedulers (a
 * retry, two instances, an operator refreshing /api/cron) from both running
 * the job and both notifying everyone. But writing it first also means a job
 * that then fails looks done for ever — the next morning finds the claim and
 * reports "already ran today", so the notices are never purged, the month
 * never closes, the leave year is never provisioned.
 *
 * In Postgres that could not happen: pg_cron called one plpgsql function, so
 * the claim and the work were one transaction and the claim rolled back with
 * the failure. Nothing here is transactional — the claim and the work touch
 * different collections, and a standalone mongod cannot span them anyway — so
 * the rollback is explicit instead.
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

// ---------------------------------------------------------------------------
// purge-old-notices
// ---------------------------------------------------------------------------

/**
 * Hard-delete expired notices. THE one implementation of the retention rule.
 *
 * `coalesce(published_at, created_at) < now() - 30 days`, as fn_purge_old_notices()
 * expressed it — so a published notice ages from its publication and a draft
 * from its creation. Two typed deletes rather than one `.or()`: both columns
 * hold BSON dates, and MongoDB orders values within a type, so a single
 * expression mixing a null test with a date bound is easy to get silently
 * wrong.
 *
 * System-scoped on purpose: retention is a housekeeping rule, not something
 * that should depend on who happened to trigger it.
 *
 * Callers: the nightly job below, and queries.purgeExpiredNotices() for the
 * opportunistic sweep on publish. It used to be written out separately in each
 * of those, with a different window in each — see NOTICE_RETENTION_DAYS.
 */
export async function deleteExpiredNotices(
  retentionDays = NOTICE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(`${addDays(todayIST(), -retentionDays)}T00:00:00Z`);
  const notices = scopedFor<BaseDoc>(COLLECTIONS.notices, SYSTEM_SCOPE);
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
export async function purgeOldNotices(
  retentionDays = NOTICE_RETENTION_DAYS,
): Promise<JobResult> {
  return claimed(
    'purge-old-notices',
    { job: 'purge_old_notices', runKey: todayIST() },
    'already ran today',
    async () => ({ affected: await deleteExpiredNotices(retentionDays) }),
  );
}

// ---------------------------------------------------------------------------
// comp-off-expiry
// ---------------------------------------------------------------------------

/** Expire comp-offs whose expiry date has passed and that were never used. */
export async function expireCompOffs(): Promise<JobResult> {
  const today = todayIST();
  return claimed(
    'comp-off-expiry',
    { job: 'compoff_expiry', runKey: today },
    'already ran today',
    async () => {
      const compOffs = scopedFor<BaseDoc>(COLLECTIONS.compOffs, SYSTEM_SCOPE);
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

// ---------------------------------------------------------------------------
// asset-warranty-reminders
// ---------------------------------------------------------------------------

/**
 * Notify staff about assets whose warranty expires within 30 days.
 *
 * Claimed per (asset, warranty date) rather than per day, exactly as the SQL
 * was — so an asset is flagged once for a given warranty date, not every
 * morning for a month.
 */
export async function warrantyReminders(): Promise<JobResult> {
  const today = todayIST();
  const horizon = addDays(today, 30);

  const assets = scopedFor<BaseDoc>(COLLECTIONS.assets, SYSTEM_SCOPE);
  const expiring = await assets.find({
    warranty_upto: { $ne: null, $gte: today, $lte: horizon },
  });

  const recipients = await staffUserIds();
  let notified = 0;

  for (const asset of expiring) {
    const key = `${asset._id}|${asset.warranty_upto}`;
    if (!(await cronClaim('warranty_reminder', key))) continue;
    // Per-item claims need the same rollback as the per-day ones: without it a
    // notification that fails to send marks the asset as reminded for that
    // warranty date, so nobody is ever told about it.
    try {
      await notifyAll(recipients, {
        kind: 'warranty',
        title: 'Asset warranty expiring',
        // desktop_name is what the collection actually calls it — every other
        // site in the app reads that field. `asset_name` does not exist, so the
        // body said only "An asset", and because the claim key is per (asset,
        // warranty date) that anonymous message was the ONLY reminder anyone
        // would ever get for it.
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

// ---------------------------------------------------------------------------
// attendance-auto-punch-out
// ---------------------------------------------------------------------------

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
      // The same seal the manual sweep checks, and for the same reason: this
      // rewrites punch_out, worked_minutes and is_corrected, and the date is
      // yesterday's — so a run on the 1st lands in the month that has just been
      // locked, paid or closed. Without it the register silently drifts away
      // from payslips that are already final. Reading the run FAILS CLOSED:
      // "cannot tell" is not "open".
      const periodMonth = periodMonthFor(date);
      const runs = scopedFor<BaseDoc>(COLLECTIONS.payrollRuns, SYSTEM_SCOPE);
      const run = await runs.findOne({ period_month: periodMonth });
      const sealed = monthSealReason(periodMonth, run as PayrollRunSeal | null);
      if (sealed) return { affected: 0, detail: sealed };

      const settings = scopedFor<BaseDoc>(COLLECTIONS.settings, SYSTEM_SCOPE);
      const row = await settings.findOne({ key: 'auto_punch_out_time' });
      // ONE definition of this setting's default and of how it parses, shared
      // with the manual sweep. See autoPunchOutMinutesFrom().
      const closeMin = autoPunchOutMinutesFrom(row?.value);
      const closeAt = minutesToClock(closeMin);

      const attendance = scopedFor<BaseDoc>(COLLECTIONS.attendanceDays, SYSTEM_SCOPE);
      const open = await attendance.find({
        work_date: date,
        punch_in: { $ne: null },
        punch_out: null,
      });

      let closed = 0;
      for (const day of open) {
        // autoCloseDay is the sweep's own arithmetic, including the night-shift
        // wrap when the close time is earlier than the punch-in. An unparseable
        // punch-in returns null and is left for a human rather than written as
        // NaN worked minutes.
        const result = autoCloseDay(clockToMinutes(day.punch_in), null, closeMin);
        if (!result) continue;
        await attendance.updateOne(
          { _id: day._id },
          {
            $set: {
              punch_out: closeAt,
              worked_minutes: result.workedMin,
              is_corrected: true,
              correction_reason: 'Auto punch-out: no closing punch was recorded.',
              updated_at: new Date(),
            },
          },
        );
        closed++;
      }

      if (closed > 0) {
        await logActivity('night_sweep', `Auto punched-out ${closed} open day(s) for ${date}`);
      }
      return { affected: closed };
    },
  );
}

// ---------------------------------------------------------------------------
// attendance-auto-close-month
// ---------------------------------------------------------------------------

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
      const runs = scopedFor<BaseDoc>(COLLECTIONS.payrollRuns, SYSTEM_SCOPE);
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

// ---------------------------------------------------------------------------
// leave-annual-provision
// ---------------------------------------------------------------------------

/** Open the current leave year. Idempotent through the ledger and by row. */
export async function leaveAnnualProvision(year?: number): Promise<JobResult> {
  const target = year ?? Number(todayIST().slice(0, 4));
  return claimed(
    'leave-annual-provision',
    { job: 'leave_provision', runKey: String(target) },
    `already provisioned ${target}`,
    // SCHEDULED is what marks this as the job runner rather than a request.
    // It used to be inferred from "there is no session", which every
    // authentication failure also satisfies — see functions.ts:Invocation.
    async () => ({ affected: await provisionLeaveBalances({ p_year: target }, SCHEDULED) }),
  );
}

// ---------------------------------------------------------------------------
// lifecycle-reminders
// ---------------------------------------------------------------------------

/** Nudge staff about exits whose last working day is within a week. */
export async function lifecycleReminders(): Promise<JobResult> {
  const today = todayIST();
  const horizon = addDays(today, 7);

  const exits = scopedFor<BaseDoc>(COLLECTIONS.exitCases, SYSTEM_SCOPE);
  const due = await exits.find({
    last_working_day: { $ne: null, $gte: today, $lte: horizon },
    stage: { $nin: ['completed', 'cancelled'] },
  });

  const recipients = await staffUserIds();
  let notified = 0;

  for (const exit of due) {
    const key = `${exit._id}|${exit.last_working_day}`;
    if (!(await cronClaim('lifecycle_reminder', key))) continue;
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

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

async function staffUserIds(): Promise<string[]> {
  const users = scopedFor<BaseDoc>(COLLECTIONS.users, SYSTEM_SCOPE);
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
  if (recipients.length === 0) return;
  const notifications = scopedFor<BaseDoc>(COLLECTIONS.notifications, SYSTEM_SCOPE);
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
  const log = scopedFor<BaseDoc>(COLLECTIONS.activityLog, SYSTEM_SCOPE);
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

// ---------------------------------------------------------------------------
// the schedule
// ---------------------------------------------------------------------------

export const JOBS = {
  'purge-old-notices': purgeOldNotices,
  'attendance-auto-punch-out': () => autoPunchOut(),
  'attendance-auto-close-month': autoCloseMonth,
  'asset-warranty-reminders': warrantyReminders,
  'comp-off-expiry': expireCompOffs,
  'leave-annual-provision': () => leaveAnnualProvision(),
  'lifecycle-reminders': lifecycleReminders,
} as const;

export type JobName = keyof typeof JOBS;

/**
 * Run every daily job.
 *
 * One job failing must not stop the others: they are independent, and a
 * warranty-notification failure has no business preventing the month from
 * closing. Each result carries its own outcome.
 */
export async function runDailyJobs(): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const [name, job] of Object.entries(JOBS)) {
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
