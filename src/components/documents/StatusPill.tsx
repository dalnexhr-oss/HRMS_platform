'use client';

// Shared document status labels and colors for the register, queue, and detail panel.
import type { EmployeeDocumentRow } from '@/lib/documents/document-summary';

const pillMeta: Record<string, { label: string; color: string }> = {
  to_sign: { label: 'Waiting for employee’s signature', color: 'var(--attendance-half-day)' },
  verified: { label: 'Verified', color: 'var(--attendance-present)' },
  awaiting: { label: 'Waiting to be checked', color: 'var(--attendance-late)' },
  returned: { label: 'Sent back to fix', color: 'var(--attendance-half-day)' },
  superseded: { label: 'Older version', color: 'var(--text-secondary)' },
};

function StatusPill({ row }: { row: EmployeeDocumentRow }) {
  const meta = pillMeta[row.status] ?? pillMeta.awaiting;
  return (
    <span
      className="status-badge document-status"
      style={{ borderColor: meta.color, color: meta.color }}
    >
      {/* A signed copy that has come back reads differently from an ordinary upload. */}
      {row.signature === 'signed' && row.status === 'awaiting'
        ? 'Signed copy received'
        : meta.label}
      {row.source === 'issued' && row.status === 'verified' ? ' · system letter' : ''}
    </span>
  );
}

export { StatusPill };
