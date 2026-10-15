// This file is loaded by the server at startup, and it registers a midnight sweep that
// runs every night at 00:00 IST to mark employees absent if they have no punches for the day.
// The sweep is only needed on the server, not in the edge runtime or the client.
async function register(): Promise<void> {
  // The sweep is only needed on the server, not in the edge runtime or the client.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMidnightSweep } = await import('@/lib/jobs/midnight-attendance-sweep');
    startMidnightSweep();
  }
}

export { register };
