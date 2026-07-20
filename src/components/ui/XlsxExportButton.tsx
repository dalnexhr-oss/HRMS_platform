'use client';

// Generic .xlsx download button. Calls a Server Action that returns base64
// workbook bytes, then decodes to a Blob and triggers a browser download. The
// action reference is passed in so this one component drives register, payroll
// and statutory exports.
import { useState, useTransition } from 'react';
import type { ExportResult } from '@/lib/actions/export';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function XlsxExportButton({
  action,
  label = 'Export .xlsx',
  className = 'btn quiet',
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
        url = URL.createObjectURL(base64ToBlob(res.base64, res.mime ?? XLSX_MIME));
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
        {pending ? 'Preparing…' : label}
      </button>
      {error ? (
        <span className="muted" style={{ fontSize: 12, color: 'var(--ab)' }}>
          {error}
        </span>
      ) : null}
    </>
  );
}
