// ============================================================================
// Runs the scheduled jobs. Replaces pg_cron's in-database schedule.
//
// AUTHENTICATION: a shared secret in the Authorization header, NOT a session.
// The caller is a machine — the host's crontab, a platform scheduler — and
// these jobs run with system privileges, so this endpoint is as powerful as the
// service-role key used to be. Without CRON_SECRET set it refuses outright
// rather than defaulting to open.
//
// Every job is individually idempotent through cron_run_log, so a double fire,
// a retry, or an operator curling this twice does the work once.
//
//   Daily, from the host:
//     0 2 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
//                  https://your-host/api/cron
// ============================================================================
import { NextResponse } from 'next/server';
import { JOBS, runDailyJobs, type JobName } from '@/lib/db/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Long enough for a full sweep over a year of attendance.
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;

  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented.length !== secret.length) return false;

  // Constant-time compare: a length-safe equality that does not leak the
  // secret one character at a time through response timing.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set, so scheduled jobs are disabled.' },
      { status: 503 },
    );
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  // ?job=<name> runs one job; no parameter runs the daily set.
  const name = new URL(req.url).searchParams.get('job') as JobName | null;
  if (name) {
    const job = JOBS[name];
    if (!job) {
      return NextResponse.json(
        { error: `Unknown job '${name}'.`, available: Object.keys(JOBS) },
        { status: 400 },
      );
    }
    return NextResponse.json({ results: [await job()] });
  }

  return NextResponse.json({ results: await runDailyJobs() });
}

export const GET = handle;
// POST too: some schedulers only issue POSTs.
export const POST = handle;
