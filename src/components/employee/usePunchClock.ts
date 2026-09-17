'use client';

// Shared punch state, location handling, and error recovery for both attendance controls. Location
// failures are allowed unless the server's requireLocation policy requires coordinates.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPunchStatus, locationPermission, punchIn, punchOut, requestCoords } from '@/lib/actions/punch';
import { announcePunch, onPunchChange } from '@/lib/punch-bus';
import type { PunchSource } from '@/lib/punch-bus';
import type { LocationFailure, PunchStatusResponse } from '@/lib/actions/punch';
import type { ToastKind } from '@/components/ui/Toast';

const timeFmt: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

export function clock(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', timeFmt).format(date);
}

// The duration is always rounded down to the nearest minute, so a punch that is 1h 59m 59s long is
// reported as 1h 59m. The server does the same rounding, so the two numbers always match.

export function duration(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safe / 60);
  return hours > 0 ? `${hours}h ${safe % 60}m` : `${safe}m`;
}

/**
 * Return a location error with the appropriate recovery action. Denied permission requires a change
 * in browser settings.
 */
export const failureText: Record<LocationFailure, string> = {
  denied:
    'Location is blocked for this site. Change your browser settings to allow it, then try again.',
  unavailable:
    'Your device could not get a location fix. Move somewhere with a clearer signal and try again.',
  timeout: 'Getting your location took too long. Try again.',
  unsupported:
    'This browser cannot share a location — it needs a secure (https) connection and ' +
    'geolocation support. Try a different browser or device.',
};

export interface PunchClock {
  state: PunchStatusResponse | null;
  loading: boolean;
  pending: boolean;
  isIn: boolean;
  worked: number;
  permission: PermissionState | 'unsupported' | null;
  /** Why the last location attempt failed, if it did. */
  blocked: LocationFailure | null;
  /** Error message if the clock could not be loaded. */
  loadError: string | null;
  /** Bumped after every punch — feed it to PunchHistory as a refresh key. */
  version: number;
  punch: () => Promise<void>;
}

export function usePunchClock(
  source: PunchSource,
  toast: (message: string, kind?: ToastKind) => void,
): PunchClock {
  const router = useRouter();
  const [state, setState] = useState<PunchStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [openFor, setOpenFor] = useState(0);
  const [version, setVersion] = useState(0);
  // Check permission without prompting so blocked location access can be shown before a punch.
  const [permission, setPermission] = useState<PermissionState | 'unsupported' | null>(null);
  const [blocked, setBlocked] = useState<LocationFailure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);
  const warnedSweep = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await getPunchStatus();
      if (alive.current) {
        setState(next);
        setLoadError(null);
      }
    } catch (reason) {
      if (alive.current) {
        setLoadError(reason instanceof Error ? reason.message : 'Could not load your clock.');
      }
    } finally {
      if (alive.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    // Refresh a tab left open overnight and tabs returning from the background.
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  // A punch made from the *other* control: re-read the status and refresh the
  // history under it. The sender skips its own event, so this cannot loop.
  useEffect(
    () =>
      onPunchChange(source, () => {
        setVersion((n) => n + 1);
        void load();
      }),
    [source, load],
  );

  // Read the permission on mount and keep it in sync: if the user fixes it in
  // browser settings, the warning should clear without a page reload.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void (async () => {
      const current = await locationPermission();
      if (!alive.current) {
        return;
      }
      setPermission(current);
      if (current === 'granted' || current === 'prompt') {
        setBlocked(null);
      }

      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: 'geolocation' as PermissionName,
          });
          const onChange = () => {
            if (!alive.current) {
              return;
            }
            setPermission(status.state);
            if (status.state !== 'denied') {
              setBlocked(null);
            }
          };
          status.addEventListener('change', onChange);
          stop = () => status.removeEventListener('change', onChange);
        } catch {
          /* no live updates on this browser — the mount read still stands */
        }
      }
    })();
    return () => stop?.();
  }, []);

  // Ticking elapsed time while a session is open. Recomputed from the punch
  // timestamp on every tick rather than incremented, so a backgrounded tab
  // (where timers are throttled) still shows the right number on return.
  useEffect(() => {
    if (state?.status !== 'in' || !state.lastPunchAt) {
      setOpenFor(0);
      return;
    }
    const since = new Date(state.lastPunchAt).getTime();
    const tick = () => setOpenFor(Math.max(0, (Date.now() - since) / 60_000));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [state?.status, state?.lastPunchAt]);

  const isIn = state?.status === 'in';

  const punch = useCallback(async () => {
    if (!state || pending) {
      return;
    }
    setPending(true);
    try {
      // Called straight out of the click so the browser will actually raise its
      // permission prompt — outside a user gesture it silently refuses to.
      const [fix, current] = await Promise.all([requestCoords(), getPunchStatus()]);
      if (!alive.current) {
        return;
      }
      setState(current);
      if (current.lastNightSweep && warnedSweep.current !== current.lastNightSweep.closedAt) {
        toast(current.lastNightSweep.message, 'info');
        warnedSweep.current = current.lastNightSweep.closedAt;
      }

      if (!fix.ok) {
        setBlocked(fix.reason);
        if (current.requireLocation) {
          // Required location is unavailable; keep the punch unsaved and explain how to retry.
          toast(failureText[fix.reason], 'error');
          return;
        }
        toast('Punching without a location — it will not be marked at-office.', 'info');
      } else {
        setBlocked(null);
      }

      const coords = fix.ok ? fix.coords : null;
      const result = current.status === 'in' ? await punchOut(coords) : await punchIn(coords);
      if (!alive.current) {
        return;
      }

      const at = clock(result.punchedAt);
      if (result.withinGeofence === false) {
        toast(`Punched ${result.kind} at ${at} — recorded as off-site.`, 'info');
      } else if (!coords) {
        toast(`Punched ${result.kind} at ${at} — no location recorded.`, 'info');
      } else {
        toast(`Punched ${result.kind} at ${at}.`, 'success');
      }

      setVersion((n) => n + 1);
      await load();
      // Wake the other control before the route refresh, so the two buttons
      // never point opposite ways even for a frame.
      announcePunch(source);
      // The month strip and today's totals elsewhere on /me are server-rendered.
      router.refresh();
    } catch (reason) {
      if (!alive.current) {
        return;
      }
      const message = reason instanceof Error ? reason.message : 'Could not record the punch.';
      toast(message, 'error');
      // A 409 means our view of in/out was stale — resync rather than leave the
      // button pointing the wrong way.
      void load();
    } finally {
      if (alive.current) {
        setPending(false);
      }
    }
  }, [state, pending, toast, load, router, source]);

  return {
    state,
    loading,
    pending,
    isIn,
    worked: (state?.workedMinutes ?? 0) + (isIn ? openFor : 0),
    permission,
    blocked,
    loadError,
    version,
    punch,
  };
}
