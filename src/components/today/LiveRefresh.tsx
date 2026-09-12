'use client';

// Keeps a server-rendered dashboard live without anyone pressing reload.
//
// WHY router.refresh() RATHER THAN A POLLING ENDPOINT. The TV board polls
// /api/tv/board because it renders one payload from one query. /today is eight
// independent queries composed on the server, each with its own error state, so
// mirroring it behind a JSON route would mean maintaining that composition
// twice and keeping the two in step. router.refresh() re-runs the page the app
// already has and React reconciles the result, so every card updates and a card
// that fails still fails on its own terms.
//
// The punch routes revalidate /today as well (see lib/punch-http.ts). That
// fixes a *navigation* to a stale board; this fixes the board someone is
// already looking at, which on an operations screen is most of the time.
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
      if (document.visibilityState === 'visible') router.refresh();
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
