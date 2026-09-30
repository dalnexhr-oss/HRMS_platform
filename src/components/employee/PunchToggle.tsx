'use client';

// Topbar attendance toggle. Share usePunchClock with the detailed card on /employee.
import { useNotifications } from '@/components/ui/Notifications';
import { usePunchClock, duration } from './usePunchClock';

function PunchToggle() {
  const { showNotification, notificationContainer } = useNotifications();
  const { state, loading, pending, webPunchAllowed, isIn, worked, loadError, punch } =
    usePunchClock('topbar', showNotification);

  // No clock to offer — an unlinked login, or the status route is down. The
  // card on /employee says why; the bar just steps out of the way rather than
  // showing a button that cannot work.
  if (loadError && !state) {
    return null;
  }

  return (
    <div className="header-punch-clock">
      {notificationContainer}
      {state?.lastNightSweep && (
        <a href="/employee#punch" className="text-muted" title={state.lastNightSweep.message}>
          Missed punch-out
        </a>
      )}
      {/* Today's running total, so the bar states where you stand before you press anything. Hidden on narrow screens — the button is the point. */}
      <span className={`header-punch-summary${isIn ? ' is-active' : ''}`} aria-hidden={loading}>
        <i className="status-dot" />
        <b className="text-monospace">{loading ? '—' : duration(worked)}</b>
      </span>
      <button
        type="button"
        className={`button header-punch-button${isIn ? ' danger' : ' primary'}`}
        onClick={() => void punch()}
        disabled={loading || pending || !state || !webPunchAllowed}
        aria-busy={pending}
        title={
          state && !webPunchAllowed
            ? 'Use the ZKTeco machine to punch in or out'
            : isIn
              ? 'Punch out for the day'
              : 'Punch in for the day'
        }
      >
        {isIn ? 'Punch out' : 'Punch in'}
      </button>
    </div>
  );
}

export { PunchToggle, PunchToggle as default };
