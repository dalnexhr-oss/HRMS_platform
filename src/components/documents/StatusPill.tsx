'use client';

// The one place a document's status becomes a colour and a word, so the
// register, the queue and the drill-down cannot drift apart on what "returned"
// looks like.
import type { EmployeeDocumentRow } from '@/lib/queries';

const META: Record<string, { label: string; color: string }> = {
  verified: { label: 'Verified', color: 'var(--p)' },
  awaiting: { label: 'Awaiting verification', color: 'var(--lm)' },
  returned: { label: 'Returned', color: 'var(--hd)' },
  superseded: { label: 'Superseded', color: 'var(--ink-2)' },
};

export function StatusPill({ row }: { row: EmployeeDocumentRow }) {
  const meta = META[row.status] ?? META.awaiting;
  return (
    <span className="pill" style={{ borderColor: meta.color, color: meta.color }}>
      {meta.label}
      {row.source === 'issued' && row.status === 'verified' ? ' · issued' : ''}
    </span>
  );
}
