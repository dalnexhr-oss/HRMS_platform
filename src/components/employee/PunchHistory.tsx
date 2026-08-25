'use client';

// The punch trail under the attendance clock. Grouped by day, newest first,
// so a multi-session day (in, lunch, back, out) reads as one block rather than
// four loose rows.
//
// The list scrolls inside its own box: the API returns the last 100 punches,
// which unchecked runs to several screens of history below a card that is
// mostly read for *today*.
import { useEffect, useState } from 'react';
import { getPunchHistory, type PunchRecord } from '@/lib/actions/punch';
import { GeoChip } from './GeoChip';

const DAY_FMT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
};
const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

/** Calendar day in the business timezone — the key rows are grouped under. */
function dayKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function groupByDay(punches: PunchRecord[]): [string, PunchRecord[]][] {
  const groups = new Map<string, PunchRecord[]>();
  for (const punch of punches) {
    const key = dayKey(punch.timestamp);
    const bucket = groups.get(key);
    if (bucket) bucket.push(punch);
    else groups.set(key, [punch]);
  }
  return [...groups.entries()];
}

export function PunchHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    getPunchHistory()
      .then(({ punches: next }) => {
        if (alive) setPunches(next);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'Unable to load history.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const days = groupByDay(punches);

  return (
    <div className="punch-history">
      <div className="fold">Punch history</div>

      {loading ? <p className="muted">Loading history…</p> : null}
      {error ? <p className="login-error">{error}</p> : null}
      {!loading && !error && punches.length === 0 ? (
        <p className="muted">No punches recorded yet.</p>
      ) : null}

      {days.length > 0 ? (
        <div className="punch-scroll">
          {days.map(([day, rows]) => (
            <div className="punch-day" key={day}>
              <div className="punch-day-hd mono">
                {new Intl.DateTimeFormat('en-IN', DAY_FMT).format(new Date(`${day}T12:00:00`))}
              </div>
              <div className="punch-day-rows">
                {rows.map((punch, index) => (
                  <div className="punch-row" key={`${punch.timestamp}-${index}`}>
                    <span className={`punch-kind ${punch.type}`}>
                      {punch.type === 'in' ? 'In' : 'Out'}
                    </span>
                    <span className="mono punch-row-time">
                      {new Intl.DateTimeFormat('en-IN', TIME_FMT).format(new Date(punch.timestamp))}
                    </span>
                    {/* Pushed to the right edge so the stamps line up into a
                        column instead of trailing whatever the time happened
                        to be. */}
                    <GeoChip
                      withinGeofence={punch.withinGeofence}
                      lat={punch.lat}
                      lng={punch.lng}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default PunchHistory;
