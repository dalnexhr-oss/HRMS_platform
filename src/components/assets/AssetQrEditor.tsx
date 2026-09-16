'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAssetQrLink } from '@/lib/actions/assets';
import { assetLinkMaxLength } from '@/lib/asset-link';
import { AssetQrCode } from './AssetQrCode';

export function AssetQrEditor({
  assetId,
  name,
  url,
}: {
  assetId: string;
  name: string;
  url: string | null;
}) {
  const router = useRouter();
  const [savedUrl, setSavedUrl] = useState(url);
  const [draftUrl, setDraftUrl] = useState(url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setMessage(null);
          startTransition(async () => {
            try {
              const result = await updateAssetQrLink(assetId, draftUrl);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSavedUrl(result.url);
              setDraftUrl(result.url ?? '');
              setMessage(result.url ? 'QR link saved.' : 'QR link removed.');
              router.refresh();
            } catch {
              setError('Could not save the QR link. Try again.');
            }
          });
        }}
      >
        <div className="f">
          <label htmlFor="asset-qr-link">QR destination link</label>
          <input
            id="asset-qr-link"
            name="qr_url"
            type="url"
            placeholder="https://example.com/assets/this-asset"
            maxLength={assetLinkMaxLength}
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            disabled={pending}
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Leave blank and save to remove the QR code.
        </p>
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
        {message && <p role="status">{message}</p>}
        <button type="submit" className="btn quiet" disabled={pending}>
          {pending ? 'Saving…' : 'Save QR link'}
        </button>
      </form>
      <AssetQrCode url={savedUrl} name={name} />
    </div>
  );
}
