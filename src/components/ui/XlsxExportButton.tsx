'use client';

// Download base64 workbook bytes returned by a Server Action as an XLSX file.
import { DownloadButton } from '@/components/ui/DownloadButton';
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
  return (
    <DownloadButton
      label={label}
      className={className}
      action={async () => {
        const res = await action();
        if (!res.ok) {
          throw new Error(res.error);
        }
        return { blob: base64ToBlob(res.base64, res.mime ?? xlsxMime), filename: res.filename };
      }}
    />
  );
}

export { XlsxExportButton };
