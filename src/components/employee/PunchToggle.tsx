'use client';

// Topbar attendance toggle. Share usePunchClock with the detailed card on /me.
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
      {/* Today's running total, so the bar states where you stand before you press anything. Hidden on narrow screens — the button is the point. */}
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
