'use client';

import { useState, useTransition } from 'react';
import { acknowledgePolicy } from '@/lib/actions/policies';
import { formatDate } from '@/lib/format';
import type { PolicyView } from '@/lib/queries';

// Employee-facing list of company policies with a one-click "mark as read".
export function PolicyList({ policies }: { policies: PolicyView[] }) {
  if (!policies.length) {
    return <div className="empty"><p>No policies published yet.</p></div>;
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
  const [acked, setAcked] = useState(policy.acknowledged);
  const [pending, startTransition] = useTransition();

  const onAck = () => {
    startTransition(async () => {
      const res = await acknowledgePolicy(policy.id);
      if (res.ok) setAcked(true);
    });
  };

  return (
    <div className="policy">
      <div className="phd">
        <h4>{policy.title}</h4>
        {policy.category && <span className="cat">{policy.category}</span>}
        <span className="ver">
          v{policy.version}
          {policy.effective_date ? ` · from ${formatDate(policy.effective_date)}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {acked ? (
          <span className="ack">✓ Read</span>
        ) : (
          <button className="btn" onClick={onAck} disabled={pending}>
            {pending ? 'Saving…' : 'Mark as read'}
          </button>
        )}
      </div>
      <p className="body">{policy.body}</p>
    </div>
  );
}
