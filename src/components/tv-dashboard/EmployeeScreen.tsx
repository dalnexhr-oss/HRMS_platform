'use client';

// Seed the TV board with server data and poll for updates. Keep the last successful result during
// failures and label it stale when polling falls behind.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '@/components/ui/Brand';
import { EmployeeCard } from './EmployeeCard';
import { presenceLabel } from '@/types/tv';
import { routes } from '@/lib/routes';
import type { BoardData, Presence } from '@/types/tv';

const pollMs = 30_000;
// Mark the board stale after this long without a successful poll.
const staleMs = 3 * pollMs;

const bands: Presence[] = ['in', 'out', 'awaited', 'off', 'leave'];

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

function EmployeeScreen({ initial }: { initial: BoardData }) {
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
      const response = await fetch(routes.tvDashboardApi, { cache: 'no-store' });
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
      <header className="card tv-head">
        <div className="tv-head-brand">
          {/* The real mark, not a retyped wordmark — same component as the sidebar and the login card, sized for the wall in globals.css. */}
          <Brand href="/dashboard" priority />
          <p>TV dashboard</p>
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

      <div className="kpis tv-kpis">
        <div className="card kpi tv-kpi is-in">
          <div className="lab">{presenceLabel.in}</div>
          <div className="val">{totals.in}</div>
        </div>
        <div className="card kpi tv-kpi">
          <div className="lab">{presenceLabel.out}</div>
          <div className="val">{totals.out}</div>
        </div>
        <div className="card kpi tv-kpi">
          <div className="lab">{presenceLabel.awaited}</div>
          <div className="val">{totals.awaited}</div>
        </div>
        <div className="card kpi tv-kpi">
          <div className="lab">Total employees</div>
          <div className="val">{totals.headcount}</div>
        </div>
      </div>

      {stale ? (
        <p className="tv-stale" role="status">
          Connection lost — showing the last update received.
        </p>
      ) : null}

      <div className="tv-body">
        {board.rows.length === 0 ? (
          <p className="card tv-empty">No active employees to show.</p>
        ) : (
          bands.map((key) => {
            const rows = board.rows.filter((row) => row.presence === key);
            if (rows.length === 0) {
              return null;
            }
            return (
              <section className="card tv-band" key={key}>
                <div className="hd">
                  <h3>{presenceLabel[key]}</h3>
                  <span className="pill tv-band-n">{rows.length}</span>
                </div>
                <div className="bd">
                  <div className="tv-grid">
                    {rows.map((row) => (
                      <EmployeeCard key={row.id} employee={row} />
                    ))}
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>

    </div>
  );
}

export { EmployeeScreen, EmployeeScreen as default };
