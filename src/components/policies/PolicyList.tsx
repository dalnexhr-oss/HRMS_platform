'use client';

import { useState, useTransition } from 'react';
import { acknowledgePolicy } from '@/lib/actions/policies';
import { formatDate } from '@/lib/format';
import type { PolicyView } from '@/lib/queries';

// Employee-facing list of company policies. "Mark as read" is the only act: it
// records a receipt in policy_acknowledgements (0004) and flips the row to
// "✓ Read".
//
// A typed-name e-signature panel used to sit beside it. It was removed on
// purpose — two controls on one row left the employee guessing which one
// actually discharged the policy. SignPanel itself is untouched and still
// available for documents that genuinely need signing.
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
  const [error, setError] = useState<string | null>(null);

  const onAck = () => {
    setError(null);
    startTransition(async () => {
      const res = await acknowledgePolicy(policy.id);
      if (res.ok) setAcked(true);
      else setError(res.error ?? 'Could not mark the policy as read.');
    });
  };

  return (
    <div className="policy">
      <div className="phd">
        <h4>{policy.title}</h4>
        {policy.category && <span className="cat">{policy.category}</span>}
        <span className="ver">
          
          {policy.effective_date ? ` ${formatDate(policy.effective_date)}` : ''}
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
      {error && <div className="login-error" role="alert">{error}</div>}
    </div>
  );
}
