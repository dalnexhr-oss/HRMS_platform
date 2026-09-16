'use client';

// Manually close open attendance sessions at the configured auto punch-out time.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runNightSweep } from '@/lib/actions/sweep';
import { useConfirm } from '@/components/ui/ConfirmDialog';

export function NightSweepButton({ date }: { date: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const confirmed = await confirm({
      title: 'Run night sweep manually?',
      message: `This closes open attendance for ${date} at the configured auto punch-out time and changes worked hours. Employees still working should punch out themselves. Continue only after checking the open sessions.`,
      confirmLabel: 'Run sweep',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
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
  };

  return (
    <>
      {confirmDialog}
      <button
        type="button"
        className="btn"
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
