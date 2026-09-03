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

/** Matches the TV board's cadence — the same data, so the same freshness. */
const REFRESH_MS = 30_000;

export function LiveRefresh({ intervalMs = REFRESH_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Never refresh a hidden tab. This dashboard gets left open for days, and a
    // background tab polling the database every 30s is pure server load that
    // nobody is reading — the visibility handler below catches it up the moment
    // it comes back to the front, so nothing is lost by staying quiet.
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
