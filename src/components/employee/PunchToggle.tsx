'use client';

// Topbar attendance toggle. Share usePunchClock with the detailed card on /employee/attendance.
import { useEffect, useId, useState } from 'react';
import { useNotifications } from '@/components/ui/Notifications';
import styles from '@/components/shell/HeaderTooltip.module.css';
import { usePunchClock, duration } from './usePunchClock';

function PunchToggle() {
  const { showNotification, notificationContainer } = useNotifications();
  const { state, loading, pending, webPunchAllowed, isIn, worked, loadError, punch } =
    usePunchClock('topbar', showNotification);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipId = useId();
  const disabled = loading || pending || !state || !webPunchAllowed;
  const tooltipText =
    state && !webPunchAllowed
      ? 'Use the ZKTeco machine to punch in or out'
      : isIn
        ? 'Punch out for the day'
        : 'Punch in for the day';

  useEffect(() => {
    if (!tooltipVisible) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTooltipVisible(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tooltipVisible]);

  // No clock to offer — an unlinked login, or the status route is down. The
  // card on /employee/attendance says why; the bar just steps out of the way rather than
  // showing a button that cannot work.
  if (loadError && !state) {
    return null;
  }

  return (
    <div className="header-punch-clock">
      {notificationContainer}
      {state?.lastNightSweep && (
        <a
          href="/employee/attendance#punch"
          className="text-muted"
          title={state.lastNightSweep.message}
        >
          Missed punch-out
        </a>
      )}
      {/* Today's running total, so the bar states where you stand before you press anything. Hidden on narrow screens — the button is the point. */}
      <span className={`header-punch-summary${isIn ? ' is-active' : ''}`} aria-hidden={loading}>
        <i className="status-dot" />
        <b className="text-monospace">{loading ? '—' : duration(worked)}</b>
      </span>
      <span
        className={styles.trigger}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
      >
        <button
          type="button"
          className={`button header-punch-button${isIn ? ' danger' : ' primary'}`}
          onClick={() => {
            setTooltipVisible(false);
            void punch();
          }}
          onFocus={() => setTooltipVisible(true)}
          onBlur={() => setTooltipVisible(false)}
          disabled={disabled}
          aria-busy={pending}
          aria-describedby={tooltipVisible ? tooltipId : undefined}
        >
          {isIn ? 'Punch out' : 'Punch in'}
        </button>
        {tooltipVisible && (
          <span id={tooltipId} role="tooltip" className={styles.tooltip}>
            {tooltipText}
          </span>
        )}
      </span>
    </div>
  );
}

export { PunchToggle, PunchToggle as default };
