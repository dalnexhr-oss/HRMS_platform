import { QRCodeSVG } from 'qrcode.react';
import { parseAssetLink } from '@/lib/asset-link';

export function AssetQrCode({ url, name }: { url: string | null; name: string }) {
  const link = parseAssetLink(url);
  if (!link.ok || !link.url) {
    return (
      <p className="muted">Add and save a destination link to generate this asset’s QR code.</p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <QRCodeSVG
        value={link.url}
        size={link.url.length > 256 ? 384 : 240}
        style={{ maxWidth: '100%', height: 'auto' }}
        level="M"
        marginSize={4}
        title={`Open the linked page for ${name}`}
      />
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ overflowWrap: 'anywhere' }}
      >
        Open linked page
      </a>
      <span className="muted" style={{ fontSize: 12 }}>
        Scan to open the saved link. The destination may require a login.
      </span>
    </div>
  );
}
