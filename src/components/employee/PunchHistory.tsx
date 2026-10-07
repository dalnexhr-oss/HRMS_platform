'use client';

// Group punches by day, newest first. Keep the last 100 events in a scrollable panel.
import { useEffect, useState } from 'react';
import { getPunchHistory } from '@/lib/actions/punch';
import { apiErrorMessage, isAbort } from '@/lib/api/client';
import { GeoChip } from './GeoChip';
import type { PunchRecord } from '@/lib/actions/punch';

const dayFmt: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
};
const timeFmt: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
};

// Calendar day in the business timezone — the key rows are grouped under.
function dayKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function groupByDay(punches: PunchRecord[]): Array<[string, PunchRecord[]]> {
  const groups = new Map<string, PunchRecord[]>();
  for (const punch of punches) {
    const key = dayKey(punch.timestamp);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(punch);
    } else {
      groups.set(key, [punch]);
    }
  }
  return [...groups.entries()];
}

function PunchHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A newer refresh, or leaving the page, cancels the request this one started.
    const controller = new AbortController();
    setError(null);
    getPunchHistory({ signal: controller.signal })
      .then(({ punches: next }) => {
        setPunches(next);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (isAbort(reason)) {
          return;
        }
        setError(apiErrorMessage(reason, 'Unable to load history.'));
        setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const days = groupByDay(punches);

  return (
    <div className="punch-history">
      <div className="section-heading">Punch history</div>

      {loading ? <p className="text-muted">Loading history…</p> : null}
      {error ? <p className="error-message">{error}</p> : null}
      {!loading && !error && punches.length === 0 ? (
        <p className="text-muted">No punches recorded yet.</p>
      ) : null}

      {days.length > 0 ? (
        <div className="punch-scroll">
          {days.map(([day, rows]) => (
            <div className="punch-day" key={day}>
              <div className="punch-day-heading text-monospace">
                {new Intl.DateTimeFormat('en-IN', dayFmt).format(new Date(`${day}T12:00:00`))}
              </div>
              <div className="punch-day-rows">
                {rows.map((punch, index) => (
                  <div className="punch-row" key={`${punch.timestamp}-${index}`}>
                    <span className={`punch-kind ${punch.type}`}>
                      {punch.type === 'in' ? 'In' : 'Out'}
                    </span>
                    <span className="text-monospace punch-row-time">
                      {new Intl.DateTimeFormat('en-IN', timeFmt).format(new Date(punch.timestamp))}
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

export { PunchHistory, PunchHistory as default };
