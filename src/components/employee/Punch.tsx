'use client';

// Attendance details for /employee. Share usePunchClock with the topbar toggle so both controls refresh
// after a punch.
import { useNotifications } from '@/components/ui/Notifications';
import { PunchHistory } from './PunchHistory';
import { GeoChip } from './GeoChip';
import { usePunchClock, clock, duration, failureText } from './usePunchClock';

function Punch({ id }: { id?: string }) {
  const { showNotification, notificationContainer } = useNotifications();
  const {
    state,
    loading,
    pending,
    webPunchAllowed,
    isIn,
    worked,
    permission,
    blocked,
    loadError,
    version,
    punch,
  } = usePunchClock('card', showNotification);

  return (
    <div className="card punch" id={id}>
      {notificationContainer}
      <div className="card-header">
        <h3>Attendance clock</h3>
        <span className="card-caption">Today</span>
      </div>
      <div className="card-body">
        {state?.lastNightSweep && (
          <p className="punch-alert is-warning" role="alert">
            <b>Missed punch-out.</b> {state.lastNightSweep.message}
          </p>
        )}
        {loading ? (
          <div className="punch-clock-layout">
            <div className="loading-placeholder loading-status" />
            <div className="loading-placeholder loading-title" style={{ marginTop: 12 }} />
          </div>
        ) : !state ? (
          <p className="punch-alert is-error" role="alert">
            {loadError ?? 'Could not load your clock.'}
          </p>
        ) : (
          <div className="punch-clock-layout">
            <div className="punch-summary">
              <span className={`punch-status${isIn ? ' is-active' : ''}`}>
                <i className="status-dot" />
                {isIn ? 'Punched in' : 'Punched out'}
              </span>
              <div className="punch-elapsed text-monospace">{duration(worked)}</div>
              <div className="punch-details text-muted">
                {state.lastPunchAt ? (
                  <>
                    Last {state.lastKind === 'in' ? 'in' : 'out'} at{' '}
                    <b className="text-monospace">{clock(state.lastPunchAt)}</b>
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
              className={`button punch-button${isIn ? ' danger' : ' primary'}`}
              onClick={() => void punch()}
              disabled={pending || !state || !webPunchAllowed}
              aria-describedby={!webPunchAllowed ? 'device-punch-help' : undefined}
              aria-busy={pending}
            >
              {isIn ? 'Punch out' : 'Punch in'}
            </button>
          </div>
        )}

        {state && !webPunchAllowed && (
          <p id="device-punch-help" className="punch-note text-muted">
            Use the ZKTeco machine to punch in or out. Your attendance and worked time appear here.
          </p>
        )}

        {/* Browser location applies only to employees with web punch access. */}
        {webPunchAllowed && state && (blocked === 'denied' || permission === 'denied') ? (
          <p className="punch-alert is-error" role="alert">
            <b>Location is blocked.</b> {failureText.denied}
            {state.requireLocation ? ' You cannot punch until it is allowed.' : ''}
          </p>
        ) : webPunchAllowed && state && blocked ? (
          <p className="punch-alert is-warning" role="alert">
            {failureText[blocked]}
          </p>
        ) : webPunchAllowed &&
          state?.requireLocation &&
          (permission === 'prompt' || permission === 'unsupported') ? (
          <p className="punch-alert is-info">
            Your browser will ask for your location when you punch. It is required, and it is only
            used to mark the punch as at-office or off-site — never to track you.
          </p>
        ) : null}

        {webPunchAllowed && state && !state.geofenceConfigured ? (
          <p className="punch-note text-muted">
            No office location is configured yet, so punches are recorded but not marked at-office
            or off-site. An admin can set one under Settings.
          </p>
        ) : null}
      </div>

      <PunchHistory refreshKey={version} />
    </div>
  );
}

export { duration, Punch, Punch as default };
