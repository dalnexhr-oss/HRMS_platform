'use client';

// Shared punch state, location handling, and error recovery for both attendance controls. Location
// failures are allowed unless the server's requireLocation policy requires coordinates.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPunchStatus, locationPermission, punchIn, punchOut, requestCoords } from '@/lib/actions/punch';
import { apiErrorMessage, isAbort } from '@/lib/api/client';
import { announcePunch, onPunchChange } from '@/lib/punch-bus';
import { allowsWebPunch, webPunchDisabled } from '@/lib/punch-access';
import type { PunchSource } from '@/lib/punch-bus';
import type { LocationFailure, PunchStatusResponse } from '@/lib/actions/punch';
import type { NotificationKind } from '@/components/ui/Notifications';

const timeFmt: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

function clock(value: string | null): string {
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

function duration(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safe / 60);
  return hours > 0 ? `${hours}h ${safe % 60}m` : `${safe}m`;
}

/**
 * Return a location error with the appropriate recovery action. Denied permission requires a change
 * in browser settings.
 */
const failureText: Record<LocationFailure, string> = {
  denied:
    'Location is blocked for this site. Change your browser settings to allow it, then try again.',
  unavailable:
    'Your device could not get a location fix. Move somewhere with a clearer signal and try again.',
  timeout: 'Getting your location took too long. Try again.',
  unsupported:
    'This browser cannot share a location — it needs a secure (https) connection and ' +
    'geolocation support. Try a different browser or device.',
};

// The topbar toggle and the attendance card are two instances of this hook on one page. A press on
// either while the other is still saving must not start a second punch.
let punchInFlight = false;

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

interface LoadOptions {
  /** The caller refreshes the page and history itself, so a changed status must not do it again. */
  quiet?: boolean;
}

interface PunchClock {
  state: PunchStatusResponse | null;
  loading: boolean;
  pending: boolean;
  webPunchAllowed: boolean;
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

function usePunchClock(
  source: PunchSource,
  showNotification: (message: string, kind?: NotificationKind) => void,
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
  // Cancels status reads still in flight when the control unmounts.
  const unmount = useRef<AbortController | null>(null);
  const warnedSweep = useRef<string | null>(null);
  const lastLoadedPunch = useRef<string | undefined>(undefined);
  const loadSequence = useRef(0);
  const webPunchAllowed = !!state && allowsWebPunch(state.punchAccess);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    unmount.current = controller;
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);

  const load = useCallback(
    async ({ quiet = false }: LoadOptions = {}) => {
      const sequence = ++loadSequence.current;
      try {
        const next = await getPunchStatus({ signal: unmount.current?.signal });
        if (alive.current && sequence === loadSequence.current) {
          const key = `${next.lastPunchAt ?? ''}:${next.lastKind ?? ''}:${next.attendanceClosed ?? false}:${next.workedMinutes}`;
          if (!quiet && lastLoadedPunch.current !== undefined && lastLoadedPunch.current !== key) {
            setVersion((n) => n + 1);
            // The card owns history and month totals; the topbar only needs its own status.
            if (source === 'card') {
              router.refresh();
            }
          }
          lastLoadedPunch.current = key;
          setState(next);
          setLoadError(null);
        }
      } catch (reason) {
        if (!isAbort(reason) && alive.current && sequence === loadSequence.current) {
          setLoadError(apiErrorMessage(reason, 'Could not load your clock.'));
        }
      } finally {
        if (alive.current && sequence === loadSequence.current) {
          setLoading(false);
        }
      }
    },
    [router, source],
  );

  useEffect(() => {
    void load();
    // Pick up terminal punches as well as tabs left open overnight or returning from the background.
    // Skipped while offline: the request cannot succeed, and `online` below catches up.
    const refresh = () => {
      if (document.visibilityState === 'visible' && !offline()) {
        void load();
      }
    };
    const timer = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  // A punch made from the *other* control: re-read the status and refresh the
  // history under it. The sender skips its own event, so this cannot loop.
  useEffect(
    () =>
      onPunchChange(source, () => {
        setVersion((n) => n + 1);
        // Quiet: the control that punched already refreshed the page.
        void load({ quiet: true });
      }),
    [source, load],
  );

  // Watch browser location only after the server allows web punching. Device-only
  // employees do not need a browser permission or a location warning.
  useEffect(() => {
    if (!webPunchAllowed) {
      setPermission(null);
      setBlocked(null);
      return;
    }
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const current = await locationPermission();
      if (!alive.current || cancelled) {
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
          if (!alive.current || cancelled) {
            return;
          }
          const onChange = () => {
            if (!alive.current || cancelled) {
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
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [webPunchAllowed]);

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
    if (!state || pending || punchInFlight) {
      return;
    }
    if (offline()) {
      showNotification('You are offline. Reconnect, then punch again.', 'error');
      return;
    }
    if (!webPunchAllowed) {
      showNotification(webPunchDisabled, 'info');
      return;
    }
    if (state.attendanceClosed) {
      showNotification(
        'Today’s attendance was corrected or closed by a sweep. Ask HR to review it.',
        'info',
      );
      return;
    }
    punchInFlight = true;
    setPending(true);
    try {
      // Refresh access before requesting location in case an admin changed it
      // while this dashboard was open.
      const current = await getPunchStatus();
      if (!alive.current) {
        return;
      }
      setState(current);
      if (!allowsWebPunch(current.punchAccess)) {
        showNotification(webPunchDisabled, 'info');
        return;
      }
      if (current.attendanceClosed) {
        showNotification(
          'Today’s attendance was corrected or closed by a sweep. Ask HR to review it.',
          'info',
        );
        return;
      }
      if (current.lastNightSweep && warnedSweep.current !== current.lastNightSweep.closedAt) {
        showNotification(current.lastNightSweep.message, 'info');
        warnedSweep.current = current.lastNightSweep.closedAt;
      }

      const fix = await requestCoords();
      if (!alive.current) {
        return;
      }
      if (!fix.ok) {
        setBlocked(fix.reason);
        if (current.requireLocation) {
          // Required location is unavailable; keep the punch unsaved and explain how to retry.
          showNotification(failureText[fix.reason], 'error');
          return;
        }
        showNotification('Punching without a location — it will not be marked at-office.', 'info');
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
        showNotification(`Punched ${result.kind} at ${at} — recorded as off-site.`, 'info');
      } else if (!coords) {
        showNotification(`Punched ${result.kind} at ${at} — no location recorded.`, 'info');
      } else {
        showNotification(`Punched ${result.kind} at ${at}.`, 'success');
      }

      setVersion((n) => n + 1);
      // Quiet: the history and page refresh for this punch are issued right here.
      await load({ quiet: true });
      // Wake the other control before the route refresh, so the two buttons
      // never point opposite ways even for a frame.
      announcePunch(source);
      // The month strip and today's totals elsewhere on /employee are server-rendered.
      router.refresh();
    } catch (reason) {
      if (!alive.current) {
        return;
      }
      showNotification(apiErrorMessage(reason, 'Could not record the punch.'), 'error');
      // A 409 means our view of in/out was stale, and after a timeout the punch may or may not
      // have been stored — resync rather than leave the button pointing the wrong way.
      void load();
    } finally {
      punchInFlight = false;
      if (alive.current) {
        setPending(false);
      }
    }
  }, [state, pending, webPunchAllowed, showNotification, load, router, source]);

  return {
    state,
    loading,
    pending,
    webPunchAllowed,
    isIn,
    worked: (state?.workedMinutes ?? 0) + (isIn ? openFor : 0),
    permission,
    blocked,
    loadError,
    version,
    punch,
  };
}

export { clock, duration, failureText, usePunchClock, type PunchClock };
