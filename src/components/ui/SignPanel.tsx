'use client';

// Capture an immutable typed-name signature. The server supplies the timestamp and request
// metadata.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgeDocument } from '@/lib/actions/acknowledge';
import { useNotifications } from '@/components/ui/Notifications';
import type { NotificationKind } from '@/components/ui/Notifications';

function SignPanel({
  kind,
  documentId,
  label = 'Sign to acknowledge',
  // Existing signature, when the document has already been signed.
  signedName,
  signedAt,
  // Supply a notification from the parent to avoid stacking one per row.
  showNotification: parentShowNotification,
}: {
  kind: string;
  documentId?: string | null;
  label?: string;
  signedName?: string | null;
  signedAt?: string | null;
  showNotification?: (message: string, kind?: NotificationKind) => void;
}) {
  const router = useRouter();
  const [isSignatureFormOpen, setIsSignatureFormOpen] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [pending, startTransition] = useTransition();
  const localNotifications = useNotifications();
  const showNotification = parentShowNotification ?? localNotifications.showNotification;

  if (signedAt) {
    const when = signedAt.slice(0, 10);
    return (
      <span
        className="signature-confirmation"
        title={`Signed by ${signedName ?? 'you'} on ${when}`}
      >
        ✍ Signed {when}
      </span>
    );
  }

  if (!isSignatureFormOpen) {
    return (
      <>
        {!parentShowNotification && localNotifications.notificationContainer}
        <button className="button quiet" onClick={() => setIsSignatureFormOpen(true)}>
          {label}
        </button>
      </>
    );
  }

  const isSignatureValid = signatureName.trim().length >= 3;

  return (
    <>
      {!parentShowNotification && localNotifications.notificationContainer}
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={signatureName}
          onChange={(e) => setSignatureName(e.target.value)}
          placeholder="Type your full name"
          aria-label="Type your full name to sign"
          style={{ width: 170, padding: '5px 8px' }}
          autoFocus
        />
        <button
          className="button primary"
          disabled={pending || !isSignatureValid}
          title={!isSignatureValid ? 'Type your full name' : undefined}
          onClick={() =>
            startTransition(async () => {
              const res = await acknowledgeDocument({
                kind,
                documentId,
                signedName: signatureName.trim(),
              });
              if (!res.ok) {
                showNotification(res.error ?? 'The signature was not recorded.', 'error');
              } else {
                showNotification('Signed — thank you.', 'success');
                setIsSignatureFormOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? 'Signing…' : 'Sign'}
        </button>
        <button
          className="button quiet"
          disabled={pending}
          onClick={() => setIsSignatureFormOpen(false)}
        >
          Cancel
        </button>
      </span>
    </>
  );
}

export { SignPanel };
