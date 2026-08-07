'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [acked, setAcked] = useState(policy.acknowledged);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The tick is optimistic, but the SERVER is the source of truth. Rows are keyed
  // by id, so React reconciles this component across a revalidation and would
  // otherwise keep a stale local `true` — the badge survived a failed write until
  // a hard reload. Adopting the incoming prop is what makes the button honest.
  const [seen, setSeen] = useState(policy.acknowledged);
  if (seen !== policy.acknowledged) {
    setSeen(policy.acknowledged);
    setAcked(policy.acknowledged);
  }

  const onAck = () => {
    setError(null);
    startTransition(async () => {
      const res = await acknowledgePolicy(policy.id);
      if (res.ok) {
        setAcked(true);
        router.refresh(); // pull the true value straight back down
      } else {
        setAcked(false);
        setError(res.error ?? 'Could not mark the policy as read.');
      }
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
      {error && <div className="login-error" role="alert">{error}</div>}
    </div>
  );
}
