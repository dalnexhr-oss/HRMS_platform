'use client';

// Closes any day left with a punch-in and no punch-out, writing the configured
// auto punch-out time (default 18:00). Sits beside the punch log because that is
// exactly where the open sessions it fixes are visible.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runNightSweep } from '@/lib/actions/sweep';

export function NightSweepButton({ date }: { date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () =>
    start(async () => {
      setError(null);
      setMessage(null);
      const res = await runNightSweep(date);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        res.closed === 0
          ? 'No open sessions to close.'
          : `Closed ${res.closed} open session${res.closed === 1 ? '' : 's'} at ${res.at}.`,
      );
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        className="btn quiet"
        onClick={onClick}
        disabled={pending}
        title="Close today's open sessions at the configured auto punch-out time"
      >
        {pending ? 'Sweeping…' : 'Night sweep'}
      </button>
      {message && (
        <span className="muted" style={{ fontSize: 12 }}>
          {message}
        </span>
      )}
      {error && (
        <span className="muted" style={{ fontSize: 12, color: 'var(--ab)' }}>
          {error}
        </span>
      )}
    </>
  );
}
