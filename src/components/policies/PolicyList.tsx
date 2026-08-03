'use client';

import { useState, useTransition } from 'react';
import { acknowledgePolicy } from '@/lib/actions/policies';
import { formatDate } from '@/lib/format';
import { SignPanel } from '@/components/ui/SignPanel';
import { useToast } from '@/components/ui/Toast';
import type { PolicyView, AcknowledgementRow } from '@/lib/queries';

// Employee-facing list of company policies. Two distinct acts, deliberately kept
// apart: "Mark as read" is a lightweight receipt (policy_acknowledgements, 0004),
// while "Sign" records a real typed-name e-signature (acknowledgements, 0037) —
// evidence with a server-stamped time and IP that nobody can alter afterwards.
export function PolicyList({
  policies,
  signatures = [],
}: {
  policies: PolicyView[];
  /** The employee's existing e-signatures, so signed policies show as signed. */
  signatures?: AcknowledgementRow[];
}) {
  const { toast, toastNode } = useToast();
  if (!policies.length) {
    return <div className="empty"><p>No policies published yet.</p></div>;
  }
  // Index by document id for an O(1) lookup per row.
  const byDoc = new Map(
    signatures.filter((s) => s.documentKind === 'policy' && s.documentId).map((s) => [s.documentId!, s]),
  );
  return (
    <div>
      {toastNode}
      {policies.map((p) => (
        <PolicyRow key={p.id} policy={p} signature={byDoc.get(p.id) ?? null} toast={toast} />
      ))}
    </div>
  );
}

function PolicyRow({
  policy,
  signature,
  toast,
}: {
  policy: PolicyView;
  signature: AcknowledgementRow | null;
  toast: (message: string, kind?: 'info' | 'error' | 'success') => void;
}) {
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
        <SignPanel
          kind="policy"
          documentId={policy.id}
          signedName={signature?.signedName}
          signedAt={signature?.signedAt}
          toast={toast}
        />
      </div>
      <p className="body">{policy.body}</p>
      {error && <div className="login-error" role="alert">{error}</div>}
    </div>
  );
}
