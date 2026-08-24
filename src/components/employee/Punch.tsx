'use client';

// Employee attendance clock — the punch in / punch out card on /me.
//
// Location is requested but never required. If the browser denies it, has no
// GPS, or takes too long, the punch still goes through; it is simply recorded
// without an at-office / off-site stamp. Blocking a punch on a GPS fix would
// mean someone standing at their desk cannot clock in.
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
import { useToast } from '@/components/ui/Toast';
import { PunchHistory } from './PunchHistory';

const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

function clock(value: string | null): string {
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
const FAILURE_TEXT: Record<LocationFailure, string> = {
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

export function Punch({ id }: { id?: string }) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [state, setState] = useState<PunchStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [openFor, setOpenFor] = useState(0);
  // Bumped after every successful punch so the history list refetches.
  const [version, setVersion] = useState(0);
  // Browser permission, checked WITHOUT prompting, so a blocked site can say so
  // before the button is pressed rather than after.
  const [permission, setPermission] = useState<PermissionState | 'unsupported' | null>(null);
  const [blocked, setBlocked] = useState<LocationFailure | null>(null);
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
      if (alive.current) setState(next);
    } catch (reason) {
      if (alive.current) {
        toast(reason instanceof Error ? reason.message : 'Could not load your clock.', 'error');
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Read the permission on mount and keep it in sync: if the user fixes it in
  // browser settings, the warning should clear without a page reload.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void (async () => {
      const state = await locationPermission();
      if (!alive.current) return;
      setPermission(state);
      if (state === 'granted' || state === 'prompt') setBlocked(null);

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

  const handlePunch = async () => {
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
      const result = isIn ? await punchOut(coords) : await punchIn(coords);
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
      // The month strip and today's totals above this card are server-rendered.
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
  };

  const worked = (state?.workedMinutes ?? 0) + (isIn ? openFor : 0);

  return (
    <div className="card punch" id={id}>
      {toastNode}
      <div className="hd">
        <h3>Attendance clock</h3>
        <span className="folio">Today</span>
      </div>
      <div className="bd">
        {loading ? (
          <div className="punch-face">
            <div className="bone bone-stamp" />
            <div className="bone bone-title" style={{ marginTop: 12 }} />
          </div>
        ) : (
          <div className="punch-face">
            <div className="punch-read">
              <span className={`punch-state${isIn ? ' on' : ''}`}>
                <i className="dot" />
                {isIn ? 'Punched in' : 'Punched out'}
              </span>
              <div className="punch-elapsed mono">{duration(worked)}</div>
              <div className="punch-meta muted">
                {state?.lastPunchAt ? (
                  <>
                    Last {state.lastKind === 'in' ? 'in' : 'out'} at{' '}
                    <b className="mono">{clock(state.lastPunchAt)}</b>
                    {state.lastWithinGeofence === true ? (
                      <span className="punch-geo at-office">At office</span>
                    ) : null}
                    {state.lastWithinGeofence === false ? (
                      <span className="punch-geo off-site">Off-site</span>
                    ) : null}
                  </>
                ) : (
                  'No punches yet today.'
                )}
              </div>
            </div>

            <button
              type="button"
              className={`btn punch-btn${isIn ? ' danger' : ' primary'}`}
              onClick={handlePunch}
              disabled={pending || !state}
              aria-busy={pending}
            >
              {isIn ? 'Punch out' : 'Punch in'}
            </button>
          </div>
        )}

        {/* Location state, loudest first. A blocked permission is the one thing
            that will stop a punch dead, so it is stated before the button is
            ever pressed — not discovered afterwards. */}
        {state && (blocked === 'denied' || permission === 'denied') ? (
          <p className="punch-alert is-bad" role="alert">
            <b>Location is blocked.</b> {FAILURE_TEXT.denied}
            {state.requireLocation ? ' You cannot punch until it is allowed.' : ''}
          </p>
        ) : state && blocked ? (
          <p className="punch-alert is-warn" role="alert">
            {FAILURE_TEXT[blocked]}
          </p>
        ) : state?.requireLocation && (permission === 'prompt' || permission === 'unsupported') ? (
          <p className="punch-alert is-info">
            Your browser will ask for your location when you punch. It is required, and it
            is only used to mark the punch as at-office or off-site — never to track you.
          </p>
        ) : null}

        {state && !state.geofenceConfigured ? (
          <p className="punch-note muted">
            No office location is configured yet, so punches are recorded but not marked
            at-office or off-site. An admin can set one under Settings.
          </p>
        ) : null}
      </div>

      <PunchHistory refreshKey={version} />
    </div>
  );
}

export default Punch;
