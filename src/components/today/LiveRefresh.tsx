'use client';

// Refresh the Server Component tree so each dashboard query retains its own error state.
// Punch-route revalidation updates later navigation; this timer updates the page already on screen.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Matches the TV board's cadence — the same data, so the same freshness.
const refreshMs = 30_000;

function LiveRefresh({ intervalMs = refreshMs }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Re-read punches and elapsed time on visible tabs; the server repeats its access checks.
    const tick = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };

    const timer = setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, intervalMs]);

  return null;
}

export { LiveRefresh, LiveRefresh as default };
