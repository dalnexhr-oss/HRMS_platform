/**
 * Run the attendance sweep at midnight IST and on server startup. Use the system job, which
 * defaults to yesterday, rather than the session-bound manual action. The unique cron_run_log claim
 * prevents duplicate work when external cron also runs.
 */
import 'server-only';
import { autoPunchOut } from '@/lib/db/scheduler';
import { isMongoConfigured } from '@/lib/db/mongo';

// The business timezone, as everywhere else in the app. IST has no DST, but
// deriving the wall clock through Intl rather than hardcoding +05:30 keeps this
// correct if the company's timezone ever changes.
const timeZone = 'Asia/Kolkata';

const secondsPerDay = 86_400;

// Run just after midnight to avoid clock skew selecting the day before yesterday.
const graceSeconds = 30;

// Retry yesterday's sweep on startup after a short database warm-up delay. cron_run_log prevents
// repeating a completed sweep.
const catchUpDelayMs = 10_000;

// Survives dev hot-reloads, which re-run instrumentation and would otherwise
// stack a second timer on every edit. Namespaced like the Mongo client.
const globalForSweep = globalThis as typeof globalThis & {
  __dalnexMidnightSweep?: { timer: NodeJS.Timeout | null };
};

/** Seconds elapsed since midnight in the business timezone. */
function secondsIntoDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);

  const at = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // `hour12: false` renders midnight as '24' on some ICU builds; '% 24' makes
  // both spellings mean the same hour.
  return (at('hour') % 24) * 3_600 + at('minute') * 60 + at('second');
}

/**
 * Milliseconds from `now` until the next sweep.
 *
 * Always measured against the absolute wall clock rather than added to the last
 * fire, so the schedule cannot drift over a long-running process.
 */
export function msUntilNextSweep(now: Date = new Date()): number {
  return (secondsPerDay - secondsIntoDay(now) + graceSeconds) * 1_000;
}

/**
 * Run the sweep once. Never throws: a failure tonight must not take the timer
 * chain down with it, or the sweep stops for every night after.
 */
async function sweep(trigger: string): Promise<void> {
  try {
    const result = await autoPunchOut();
    const outcome = result.ran
      ? `closed ${result.affected} open day(s)`
      : (result.detail ?? 'skipped');
    console.info(`[midnight-sweep] ${trigger}: ${outcome}`);
  } catch (e) {
    console.error(`[midnight-sweep] ${trigger} failed:`, e instanceof Error ? e.message : e);
  }
}

function scheduleNext(): void {
  const delay = msUntilNextSweep();
  const timer = setTimeout(() => {
    void sweep('midnight').finally(scheduleNext);
  }, delay);
  // Do not hold the process open on our account; the HTTP listener is what
  // keeps the server alive, and a shutdown should not wait on a sleeping timer.
  timer.unref?.();
  if (globalForSweep.__dalnexMidnightSweep) {
    globalForSweep.__dalnexMidnightSweep.timer = timer;
  }
}

/**
 * Start the midnight sweep. Idempotent — calling it twice does not stack timers.
 *
 * Set `DISABLE_INTERNAL_CRON=1` to turn this off, for deployments that would
 * rather drive `/api/cron` from a host crontab or a platform scheduler.
 */
export function startMidnightSweep(): void {
  if (process.env.DISABLE_INTERNAL_CRON) {
    console.info('[midnight-sweep] disabled by DISABLE_INTERNAL_CRON.');
    return;
  }
  // Nothing to sweep against, and no reason to log a connection failure every
  // night. `/api/cron` reports the same misconfiguration when it is called.
  if (!isMongoConfigured()) {
    console.warn('[midnight-sweep] MONGO_URI is not set — the nightly sweep will not run.');
    return;
  }
  if (globalForSweep.__dalnexMidnightSweep) {
    return;
  }
  globalForSweep.__dalnexMidnightSweep = { timer: null };

  const catchUp = setTimeout(() => void sweep('startup catch-up'), catchUpDelayMs);
  catchUp.unref?.();

  scheduleNext();
  const hours = (msUntilNextSweep() / 3_600_000).toFixed(1);
  console.info(`[midnight-sweep] armed — next run at 00:00 ${timeZone}, in ${hours}h.`);
}
