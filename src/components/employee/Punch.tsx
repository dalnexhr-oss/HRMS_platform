'use client';

// Employee attendance clock — the punch in / punch out card on /me.
//
// The quick toggle in the top bar (PunchToggle) is the control most punches go
// through; this card is the full read — today's total, the last punch and where
// it was taken, and the trail underneath. Both share usePunchClock, so pressing
// either one redraws the other.
import { useToast } from '@/components/ui/Toast';
import { PunchHistory } from './PunchHistory';
import { GeoChip } from './GeoChip';
import { usePunchClock, clock, duration, FAILURE_TEXT } from './usePunchClock';

export { duration } from './usePunchClock';

export function Punch({ id }: { id?: string }) {
  const { toast, toastNode } = useToast();
  const { state, loading, pending, isIn, worked, permission, blocked, loadError, version, punch } =
    usePunchClock('card', toast);

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
        ) : !state ? (
          <p className="punch-alert is-bad" role="alert">
            {loadError ?? 'Could not load your clock.'}
          </p>
        ) : (
          <div className="punch-face">
            <div className="punch-read">
              <span className={`punch-state${isIn ? ' on' : ''}`}>
                <i className="dot" />
                {isIn ? 'Punched in' : 'Punched out'}
              </span>
              <div className="punch-elapsed mono">{duration(worked)}</div>
              <div className="punch-meta muted">
                {state.lastPunchAt ? (
                  <>
                    Last {state.lastKind === 'in' ? 'in' : 'out'} at{' '}
                    <b className="mono">{clock(state.lastPunchAt)}</b>
                    <GeoChip
                      withinGeofence={state.lastWithinGeofence}
                      lat={state.lastLat}
                      lng={state.lastLng}
                    />
                  </>
                ) : (
                  'No punches yet today.'
                )}
              </div>
            </div>

            <button
              type="button"
              className={`btn punch-btn${isIn ? ' danger' : ' primary'}`}
              onClick={() => void punch()}
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
