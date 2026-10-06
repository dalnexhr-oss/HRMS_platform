'use client';

// Download base64 workbook bytes returned by a Server Action as an XLSX file.
import { useState, useTransition } from 'react';
import type { ExportResult } from '@/lib/actions/export';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function XlsxExportButton({
  action,
  label = 'Excel',
  className = 'button',
}: {
  action: () => Promise<ExportResult>;
  label?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () =>
    start(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      let url: string | null = null;
      try {
        url = URL.createObjectURL(base64ToBlob(res.base64, res.mime ?? xlsxMime));
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Download failed.');
      } finally {
        if (url) {
          const toRevoke = url;
          setTimeout(() => URL.revokeObjectURL(toRevoke), 0);
        }
      }
    });

  return (
    <>
      <button type="button" className={className} onClick={onClick} disabled={pending}>
        {pending ? (
          'Preparing…'
        ) : (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" />
            </svg>
            {label}
          </>
        )}
      </button>
      {error ? (
        <span className="text-muted" style={{ fontSize: 12, color: 'var(--attendance-absent)' }}>
          {error}
        </span>
      ) : null}
    </>
  );
}

export { XlsxExportButton };
