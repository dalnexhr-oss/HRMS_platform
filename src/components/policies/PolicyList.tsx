'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgePolicy } from '@/lib/actions/policies';
import { formatDate } from '@/lib/display-formatting';
import type { PolicyView } from '@/lib/server-queries';

// Record company policy read receipts. Signing documents is handled separately by SignPanel.
function PolicyList({ policies }: { policies: PolicyView[] }) {
  if (!policies.length) {
    return (
      <div className="empty-state">
        <p>No policies published yet.</p>
      </div>
    );
  }
  return (
    <div>
      {policies.map((p) => (
        <PolicyRow key={p.id} policy={p} />
      ))}
    </div>
  );
}

function PolicyRow({ policy }: { policy: PolicyView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Use the server receipt as the source of truth. Keep refresh inside the transition so the saving
  // state lasts until the persisted acknowledgement arrives.
  const acked = policy.acknowledged;

  const onAck = () => {
    setError(null);
    startTransition(async () => {
      const res = await acknowledgePolicy(policy.id);
      if (!res.ok) {
        setError(res.error ?? 'Could not mark the policy as read.');
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="policy">
      <div className="entry-header">
        <h4>{policy.title}</h4>
        {policy.category && <span className="entry-category">{policy.category}</span>}
        <span className="entry-version">
          v{policy.version}
          {policy.effective_date ? ` · from ${formatDate(policy.effective_date)}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {acked ? (
          <span className="signature-confirmation">✓ Read</span>
        ) : (
          <button className="button" onClick={onAck} disabled={pending}>
            {pending ? 'Saving…' : 'Mark as read'}
          </button>
        )}
      </div>
      <p className="entry-body">{policy.body}</p>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export { PolicyList };
