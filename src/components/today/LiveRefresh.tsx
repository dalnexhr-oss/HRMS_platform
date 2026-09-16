'use client';

// Refresh the Server Component tree so each dashboard query retains its own error state.
// Punch-route revalidation updates later navigation; this timer updates the page already on screen.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Matches the TV board's cadence — the same data, so the same freshness.
const refreshMs = 30_000;

export function LiveRefresh({ intervalMs = refreshMs }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Refresh on a visible tab every interval.
    // The TV board is often left on a signed-in session for weeks, so it is gated like the portal.
    // The tab-access check is repeated HERE rather than inherited.
    const tick = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };

    const timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, intervalMs]);

  return null;
}

export default LiveRefresh;
