/** Register the midnight attendance sweep when the Node.js server starts. */
export async function register(): Promise<void> {
  // Keep the positive NEXT_RUNTIME branch so webpack removes Node-only imports from the edge
  // bundle. An early return does not provide the same build-time exclusion.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMidnightSweep } = await import('@/lib/db/midnight');
    startMidnightSweep();
  }
}
