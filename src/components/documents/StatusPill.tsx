'use client';

// Shared document status labels and colors for the register, queue, and detail panel.
import type { EmployeeDocumentRow } from '@/lib/queries';

const pillMeta: Record<string, { label: string; color: string }> = {
  verified: { label: 'Verified', color: 'var(--attendance-present)' },
  awaiting: { label: 'Awaiting verification', color: 'var(--attendance-late)' },
  returned: { label: 'Returned', color: 'var(--attendance-half-day)' },
  superseded: { label: 'Superseded', color: 'var(--text-secondary)' },
};

function StatusPill({ row }: { row: EmployeeDocumentRow }) {
  const meta = pillMeta[row.status] ?? pillMeta.awaiting;
  return (
    <span className="status-badge document-status" style={{ borderColor: meta.color, color: meta.color }}>
      {meta.label}
      {row.source === 'issued' && row.status === 'verified' ? ' · issued' : ''}
    </span>
  );
}

export { StatusPill };
