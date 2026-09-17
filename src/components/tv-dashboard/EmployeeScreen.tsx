'use client';

// Seed the TV board with server data and poll for updates. Keep the last successful result during
// failures and label it stale when polling falls behind.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/ui/Brand';
import { EmployeeCard } from './EmployeeCard';
import type { BoardData, Presence } from '@/types/tv';

const pollMs = 30_000;
// Mark the board stale after this long without a successful poll.
const staleMs = 3 * pollMs;

const bands: { key: Presence; label: string }[] = [
  { key: 'in', label: 'In office' },
  { key: 'out', label: 'Clocked out' },
  { key: 'awaited', label: 'Not in yet' },
  { key: 'off', label: 'Away' },
  { key: 'leave', label: 'On leave' },
];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Seeded in an effect, never during render: the server and the wall clock
    // will not agree to the second and React would flag the mismatch.
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function EmployeeScreen({ initial }: { initial: BoardData }) {
  const [board, setBoard] = useState<BoardData>(initial);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const now = useNow();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/tv/board', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('board fetch failed');
      }
      const next = (await response.json()) as BoardData;
      if (!alive.current) {
        return;
      }
      setBoard(next);
      setStaleSince(null);
    } catch {
      // Keep the last good board up. A wall screen showing yesterday's floor is
      // worse than useless, so record when we lost touch and surface it below.
      if (alive.current) {
        setStaleSince((since) => since ?? Date.now());
      }
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(poll, pollMs);
    // Coming back from a sleeping display: refresh immediately rather than
    // waiting out the remainder of the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const stale = staleSince != null && Date.now() - staleSince > staleMs;
  const { totals } = board;

  return (
    <div className="tv">
      <header className="tv-head">
        <div className="tv-head-brand">
          {/* The real mark, not a retyped wordmark — same component as the sidebar and the login card, sized for the wall in globals.css. */}
          <Brand priority />
          <p>Attendance board</p>
          {/* The board replaces the whole shell, so this is the only way back out for someone who opened it from the sidebar. */}
          <Link className="tv-exit" href="/today">
            ← Back to portal
          </Link>
        </div>

        <div className="tv-kpis">
          <div className="tv-kpi is-in">
            <span className="tv-kpi-val">{totals.in}</span>
            <span className="tv-kpi-lab">On floor</span>
          </div>
          <div className="tv-kpi">
            <span className="tv-kpi-val">{totals.out}</span>
            <span className="tv-kpi-lab">Clocked out</span>
          </div>
          <div className="tv-kpi">
            <span className="tv-kpi-val">{totals.awaited}</span>
            <span className="tv-kpi-lab">Not in yet</span>
          </div>
          <div className="tv-kpi">
            <span className="tv-kpi-val">{totals.headcount}</span>
            <span className="tv-kpi-lab">Headcount</span>
          </div>
        </div>

        <div className="tv-clock">
          <span className="tv-time mono">
            {now
              ? new Intl.DateTimeFormat('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                  timeZone: 'Asia/Kolkata',
                }).format(now)
              : '--:--'}
          </span>
          <span className="tv-date">
            {new Intl.DateTimeFormat('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'Asia/Kolkata',
            }).format(new Date(`${board.date}T12:00:00`))}
          </span>
        </div>
      </header>

      {stale ? (
        <p className="tv-stale" role="status">
          Connection lost — showing the last update received.
        </p>
      ) : null}

      <div className="tv-body">
        {board.rows.length === 0 ? (
          <p className="tv-empty">No active employees to show.</p>
        ) : (
          bands.map(({ key, label }) => {
            const rows = board.rows.filter((row) => row.presence === key);
            if (rows.length === 0) {
              return null;
            }
            return (
              <section className="tv-band" key={key}>
                <h2 className="tv-band-hd">
                  {label} <span className="tv-band-n">{rows.length}</span>
                </h2>
                <div className="tv-grid">
                  {rows.map((row) => (
                    <EmployeeCard key={row.id} employee={row} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

export default EmployeeScreen;
