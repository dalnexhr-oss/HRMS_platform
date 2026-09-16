// Run scheduled jobs with system privileges. Requests require the CRON_SECRET bearer token; an
// unset secret disables the endpoint. Each job uses cron_run_log to prevent duplicate work.
//
// Example cron entry:
// 0 2 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron
import { NextResponse } from 'next/server';
import { jobs, runDailyJobs, type JobName } from '@/lib/db/scheduler';

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
    const job = jobs[name];
    if (!job) {
      return NextResponse.json(
        { error: `Unknown job '${name}'.`, available: Object.keys(jobs) },
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
