'use client';

// The punch in / punch out control in the employee top bar.
//
// It sits where Sign out used to: the clock is the one thing pressed every day,
// in a hurry, and it used to live far enough down /me that you had to scroll —
// landing it right beside a Sign out button that ends the session on a misfire.
// Sign out has moved to the foot of the page, so the two can no longer be
// confused for one another.
//
// The state lives in usePunchClock, shared with the full card on /me, so both
// buttons always read the same way.
import { useToast } from '@/components/ui/Toast';
import { usePunchClock, duration } from './usePunchClock';

export function PunchToggle() {
  const { toast, toastNode } = useToast();
  const { state, loading, pending, isIn, worked, loadError, punch } = usePunchClock(
    'topbar',
    toast,
  );

  // No clock to offer — an unlinked login, or the status route is down. The
  // card on /me says why; the bar just steps out of the way rather than
  // showing a button that cannot work.
  if (loadError && !state) return null;

  return (
    <div className="punch-top">
      {toastNode}
      {/* Today's running total, so the bar states where you stand before you
          press anything. Hidden on narrow screens — the button is the point. */}
      <span className={`punch-top-read${isIn ? ' on' : ''}`} aria-hidden={loading}>
        <i className="dot" />
        <b className="mono">{loading ? '—' : duration(worked)}</b>
      </span>
      <button
        type="button"
        className={`btn punch-top-btn${isIn ? ' danger' : ' primary'}`}
        onClick={() => void punch()}
        disabled={loading || pending || !state}
        aria-busy={pending}
        title={isIn ? 'Punch out for the day' : 'Punch in for the day'}
      >
        {isIn ? 'Punch out' : 'Punch in'}
      </button>
    </div>
  );
}

export default PunchToggle;
