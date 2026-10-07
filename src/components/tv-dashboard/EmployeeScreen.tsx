'use client';

// Seed the TV board with server data and poll for updates. Keep the last successful result during
// failures and label it stale when polling falls behind.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '@/components/ui/Brand';
import { EmployeeCard } from './EmployeeCard';
import { presenceLabel } from '@/types/tv-dashboard';
import { routes } from '@/lib/application-routes';
import { apiRequest, isAbort } from '@/lib/api/client';
import type { BoardData, Presence } from '@/types/tv-dashboard';

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
  // Cancels a poll still in flight when the board unmounts.
  const unmount = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    unmount.current = controller;
    return () => controller.abort();
  }, []);

  const poll = useCallback(async () => {
    try {
      // The client times a hung request out and shares one already in flight, so a slow server
      // cannot pile up a new poll every interval. No retries: the next tick is the retry.
      const next = await apiRequest<BoardData>(routes.tvDashboardApi, {
        signal: unmount.current?.signal,
        retries: 0,
      });
      setBoard(next);
      setStaleSince(null);
    } catch (reason) {
      // Keep the last good board up. A wall screen showing yesterday's floor is
      // worse than useless, so record when we lost touch and surface it below.
      if (!isAbort(reason)) {
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
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const stale = staleSince != null && Date.now() - staleSince > staleMs;
  const { totals } = board;

  return (
    <div className="tv-dashboard-content">
      <header className="card tv-dashboard-header">
        <div className="tv-dashboard-brand">
          {/* The real mark, not a retyped wordmark — same component as the sidebar and the login card, sized for the wall in globals.css. */}
          <Brand href="/dashboard" priority />
          <p>TV dashboard</p>
        </div>

        <div className="tv-dashboard-clock">
          <span className="tv-dashboard-time text-monospace">
            {now
              ? new Intl.DateTimeFormat('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                  timeZone: 'Asia/Kolkata',
                }).format(now)
              : '--:--'}
          </span>
          <span className="tv-dashboard-date">
            {new Intl.DateTimeFormat('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'Asia/Kolkata',
            }).format(new Date(`${board.date}T12:00:00`))}
          </span>
        </div>
      </header>

      <div className="summary-cards tv-dashboard-summary-cards">
        <div className="card summary-card tv-dashboard-summary-card is-in">
          <div className="metric-label">{presenceLabel.in}</div>
          <div className="metric-value">{totals.in}</div>
        </div>
        <div className="card summary-card tv-dashboard-summary-card">
          <div className="metric-label">{presenceLabel.out}</div>
          <div className="metric-value">{totals.out}</div>
        </div>
        <div className="card summary-card tv-dashboard-summary-card">
          <div className="metric-label">{presenceLabel.awaited}</div>
          <div className="metric-value">{totals.awaited}</div>
        </div>
        <div className="card summary-card tv-dashboard-summary-card">
          <div className="metric-label">Total employees</div>
          <div className="metric-value">{totals.headcount}</div>
        </div>
      </div>

      {stale ? (
        <p className="tv-dashboard-stale-notice" role="status">
          Connection lost — showing the last update received.
        </p>
      ) : null}

      <div className="tv-dashboard-body">
        {board.rows.length === 0 ? (
          <p className="card tv-dashboard-empty">No active employees to show.</p>
        ) : (
          bands.map((key) => {
            const rows = board.rows.filter((row) => row.presence === key);
            if (rows.length === 0) {
              return null;
            }
            return (
              <section className="card tv-dashboard-group" key={key}>
                <div className="card-header">
                  <h3>{presenceLabel[key]}</h3>
                  <span className="status-badge tv-dashboard-group-count">{rows.length}</span>
                </div>
                <div className="card-body">
                  <div className="tv-dashboard-grid">
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
