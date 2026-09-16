'use client';

// Shared document status labels and colors for the register, queue, and detail panel.
import type { EmployeeDocumentRow } from '@/lib/queries';

const pillMeta: Record<string, { label: string; color: string }> = {
  verified: { label: 'Verified', color: 'var(--p)' },
  awaiting: { label: 'Awaiting verification', color: 'var(--lm)' },
  returned: { label: 'Returned', color: 'var(--hd)' },
  superseded: { label: 'Superseded', color: 'var(--ink-2)' },
};

export function StatusPill({ row }: { row: EmployeeDocumentRow }) {
  const meta = pillMeta[row.status] ?? pillMeta.awaiting;
  return (
    <span className="pill" style={{ borderColor: meta.color, color: meta.color }}>
      {meta.label}
      {row.source === 'issued' && row.status === 'verified' ? ' · issued' : ''}
    </span>
  );
}
