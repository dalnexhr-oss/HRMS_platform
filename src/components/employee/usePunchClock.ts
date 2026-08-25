'use client';

// The employee attendance clock, minus its chrome.
//
// Two controls drive the same clock — the compact toggle in the top bar and the
// full card further down /me — and both have to apply identical rules about
// location, sequence errors and re-syncing after a rejected punch. Keeping that
// in one hook is the only way the two cannot disagree.
//
// Location is requested but never required here. If the browser denies it, has
// no GPS, or takes too long, the punch still goes through; it is simply
// recorded without an at-office / off-site stamp. Whether a location-less punch
// is refused at all is the server's call (PunchStatusResponse.requireLocation).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getPunchStatus,
  locationPermission,
  punchIn,
  punchOut,
  requestCoords,
  type LocationFailure,
  type PunchStatusResponse,
} from '@/lib/actions/punch';
import type { ToastKind } from '@/components/ui/Toast';
import { announcePunch, onPunchChange, type PunchSource } from '@/lib/punch-bus';

const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

export function clock(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', TIME_FMT).format(date);
}

/** 138 -> '2h 18m'. Used for both today's total and the open session. */
export function duration(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safe / 60);
  return hours > 0 ? `${hours}h ${safe % 60}m` : `${safe}m`;
}

/**
 * What to tell someone when the location attempt fails. Each case has a
 * different remedy, so they get different words — "denied" is the only one they
 * have to go and fix in browser settings, and it is the one that used to be
 * silently swallowed.
 */
export const FAILURE_TEXT: Record<LocationFailure, string> = {
  denied:
    'Location is blocked for this site. Open the padlock (or ⓘ) in the address bar, ' +
    'set Location to Allow, then reload and try again. On a phone, also check that ' +
    'location is enabled for your browser in the system settings.',
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
  /** Minutes worked today, including the session that is still open. */
  worked: number;
  /** Browser geolocation permission, read without prompting. */
  permission: PermissionState | 'unsupported' | null;
  /** Why the last location attempt failed, if it did. */
  blocked: LocationFailure | null;
  /**
   * Why the status could not be read. Reported rather than toasted: the usual
   * cause is a login with no employee record behind it, which is permanent —
   * a notice that scrolls away after four seconds is the wrong shape for it,
   * and it would fire on every page the top-bar clock is mounted on.
   */
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
  // Browser permission, checked WITHOUT prompting, so a blocked site can say so
  // before the button is pressed rather than after.
  const [permission, setPermission] = useState<PermissionState | 'unsupported' | null>(null);
  const [blocked, setBlocked] = useState<LocationFailure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);

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
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
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
      if (!alive.current) return;
      setPermission(current);
      if (current === 'granted' || current === 'prompt') setBlocked(null);

      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: 'geolocation' as PermissionName,
          });
          const onChange = () => {
            if (!alive.current) return;
            setPermission(status.state);
            if (status.state !== 'denied') setBlocked(null);
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
    if (!state || pending) return;
    setPending(true);
    try {
      // Called straight out of the click so the browser will actually raise its
      // permission prompt — outside a user gesture it silently refuses to.
      const fix = await requestCoords();
      if (!alive.current) return;

      if (!fix.ok) {
        setBlocked(fix.reason);
        if (state.requireLocation) {
          // The refusal the user asked for: no punch, and a reason on screen.
          toast(FAILURE_TEXT[fix.reason], 'error');
          return;
        }
        toast('Punching without a location — it will not be marked at-office.', 'info');
      } else {
        setBlocked(null);
      }

      const coords = fix.ok ? fix.coords : null;
      const result = state.status === 'in' ? await punchOut(coords) : await punchIn(coords);
      if (!alive.current) return;

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
      if (!alive.current) return;
      const message = reason instanceof Error ? reason.message : 'Could not record the punch.';
      toast(message, 'error');
      // A 409 means our view of in/out was stale — resync rather than leave the
      // button pointing the wrong way.
      void load();
    } finally {
      if (alive.current) setPending(false);
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
