'use client';

// Reusable e-signature control: type your name, sign once, see the record.
//
// This is a step ABOVE the existing "mark as read" receipt — a signature carries
// a typed name plus a server-stamped time and IP, and cannot be edited or
// removed by anyone (see migration 0037 §4). The component never sends a
// timestamp; the database clock supplies it.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgeDocument } from '@/lib/actions/acknowledge';
import { useToast, type ToastKind } from '@/components/ui/Toast';

export function SignPanel({
  kind,
  documentId,
  label = 'Sign to acknowledge',
  /** Existing signature, when the document has already been signed. */
  signedName,
  signedAt,
  /** Supply a toast from the parent to avoid stacking one per row. */
  toast: parentToast,
}: {
  kind: string;
  documentId?: string | null;
  label?: string;
  signedName?: string | null;
  signedAt?: string | null;
  toast?: (message: string, kind?: ToastKind) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();
  const own = useToast();
  const toast = parentToast ?? own.toast;

  if (signedAt) {
    const when = signedAt.slice(0, 10);
    return (
      <span className="ack" title={`Signed by ${signedName ?? 'you'} on ${when}`}>
        ✍ Signed {when}
      </span>
    );
  }

  if (!open) {
    return (
      <>
        {!parentToast && own.toastNode}
        <button className="btn quiet" onClick={() => setOpen(true)}>
          {label}
        </button>
      </>
    );
  }

  const ready = name.trim().length >= 3;

  return (
    <>
      {!parentToast && own.toastNode}
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your full name"
          aria-label="Type your full name to sign"
          style={{ width: 170, padding: '5px 8px' }}
          autoFocus
        />
        <button
          className="btn primary"
          disabled={pending || !ready}
          title={!ready ? 'Type your full name' : undefined}
          onClick={() =>
            startTransition(async () => {
              const res = await acknowledgeDocument({ kind, documentId, signedName: name.trim() });
              if (!res.ok) toast(res.error ?? 'The signature was not recorded.', 'error');
              else {
                toast('Signed — thank you.', 'success');
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? 'Signing…' : 'Sign'}
        </button>
        <button className="btn quiet" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </>
  );
}
