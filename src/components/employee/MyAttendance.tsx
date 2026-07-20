'use client';

import { useState } from 'react';
import { Stamp } from '@/components/ui/Stamp';
import { DOW } from '@/lib/constants';
import type { DayCell } from '@/types/domain';

/** Statuses that read as "you were at work" for the summary strip. */
const PRESENT_LIKE = new Set(['P', 'LM', 'S', 'T']);

/** 'HH:MM' -> minutes. Returns 0 for null/blank so it can be summed safely. */
function hoursToMinutes(hours: string | null): number {
  if (!hours) return 0;
  const [h, m] = hours.split(':');
  return Number(h) * 60 + Number(m);
}

function formatHrs(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Weekday initials for a day-of-month, derived from the real calendar rather
 * than the register's `DOW[(d - 1) % 7]` shortcut (which only holds for months
 * that happen to start on a Monday, as June 2026 does).
 */
function dowFor(periodMonth: string, day: number): string {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  const jsDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return DOW[(jsDow + 6) % 7]; // DOW is Mon-first
}

/** '2026-06-01' -> 'June 2026'. */
function monthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The employee's own month strip — the register's day-cell language, for a
 * single person. Read-only: no cell here is editable from the employee side.
 */
export function MyAttendance({
  days,
  periodMonth,
}: {
  days: DayCell[];
  periodMonth: string;
}) {
  const [showPunches, setShowPunches] = useState(true);

  const summary = {
    P: days.filter((d) => d.status === 'P').length,
    LM: days.filter((d) => d.status === 'LM').length,
    HD: days.filter((d) => d.status === 'HD').length,
    L: days.filter((d) => d.status === 'L').length,
    WO: days.filter((d) => d.status === 'WO').length,
  };
  const workedMinutes = days.reduce((a, d) => a + hoursToMinutes(d.hours), 0);
  const markedDays = days.filter((d) => PRESENT_LIKE.has(d.status)).length;

  return (
    <div className="card register">
      <div className="hd">
        <h3>My attendance — {monthLabel(periodMonth)}</h3>
        <span className="folio">
          {days.length ? `${days.length} days marked` : 'No days marked'}
        </span>
      </div>

      {days.length === 0 ? (
        <div className="bd">
          <div className="empty">
            <h3>Nothing marked yet</h3>
            <p>
              Your attendance for {monthLabel(periodMonth)} has not been recorded. Days appear here
              as punches are imported.
            </p>
          </div>
        </div>
      ) : (
        <div className="reg-scroll">
          <div style={{ minWidth: 250 + days.length * 44 }}>
            {/* header row */}
            <div className="rrow hd-row">
              <div className="emp-cell">
                <span
                  className="folio"
                  style={{
                    font: '600 10px var(--mono)',
                    letterSpacing: '.14em',
                    color: 'var(--ink-3)',
                  }}
                >
                  MY MONTH · SUMMARY
                </span>
              </div>
              <div className="daystrip">
                {days.map((d) => (
                  <div key={d.day} className={`dhead${d.isWeekOff ? ' wo-col' : ''}`}>
                    <div className="dw">{dowFor(periodMonth, d.day)}</div>
                    <div className="dn">{d.day}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* the single employee row */}
            <div className={`rrow${showPunches ? ' open' : ''}`}>
              <div className="emp-cell">
                <div className="sums">
                  <span>
                    P <b>{summary.P}</b>
                  </span>
                  <span>
                    LM <b>{summary.LM}</b>
                  </span>
                  <span>
                    HD <b>{summary.HD}</b>
                  </span>
                  <span>
                    L <b>{summary.L}</b>
                  </span>
                  <span>
                    WO <b>{summary.WO}</b>
                  </span>
                </div>
                <div className="meta mono">
                  {formatHrs(workedMinutes)} hrs over {markedDays} day
                  {markedDays === 1 ? '' : 's'}
                </div>
                <button className="rowtoggle" onClick={() => setShowPunches((s) => !s)}>
                  {showPunches ? 'Hide punches' : 'Show punches'}
                </button>
              </div>
              <div className="daystrip">
                {days.map((c) => (
                  <div
                    key={c.day}
                    className={`dcell${c.isWeekOff ? ' wo-col' : ''}`}
                    title={c.in ? `${c.in} – ${c.out} · ${c.hours}` : undefined}
                  >
                    <div style={{ display: 'grid', placeItems: 'center' }}>
                      <Stamp status={c.status} />
                      {c.in ? (
                        <div className="tms">
                          {c.in}
                          <br />
                          {c.out ?? '—'}
                          <br />
                          <b>{c.hours ?? '—'}</b>
                        </div>
                      ) : (
                        <div className="tms muted">—</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
