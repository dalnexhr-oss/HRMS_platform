/**
 * Next.js boot hook — runs once per server process, before the first request.
 *
 * The only thing registered here is the midnight attendance sweep. See
 * lib/db/midnight.ts for why the app schedules it itself rather than leaving it
 * to a host crontab.
 */
export async function register(): Promise<void> {
  // This file is compiled for the edge runtime too — the auth middleware puts
  // it in that bundle — and neither the Mongo driver nor `server-only` can be
  // built there. NEXT_RUNTIME is substituted at build time, so this must stay a
  // positive `if` block: webpack drops the whole branch before it walks the
  // import, which an early `return` guard does not do. The build fails on
  // missing 'net'/'tls' if this is ever rewritten as one.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMidnightSweep } = await import('@/lib/db/midnight');
    startMidnightSweep();
  }
}
