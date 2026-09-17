'use client';

import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportPunchLogXlsx } from '@/lib/actions/export';
import type { PunchLogRow } from '@/types/domain';

interface ExportButtonProps {
  // Disable an empty export locally; the action re-queries the data before building the workbook.
  rows: PunchLogRow[];
  // Use the server's IST business date for the export filename.
  date: string;
  // Distinguish a failed query from an empty punch log.
  disabledReason?: string | null;
}

// Download the branded punch-log workbook through the shared export button.
export function ExportButton({ rows, date, disabledReason = null }: ExportButtonProps) {
  const disabled = disabledReason !== null || rows.length === 0;
  const reason = disabledReason ?? (rows.length === 0 ? 'Nothing to export yet' : null);

  if (disabled) {
    return (
      <button
        type="button"
        className="btn"
        disabled
        title={reason ?? undefined}
        style={{ opacity: 0.5, cursor: 'default' }}
      >
        Export
      </button>
    );
  }

  return <XlsxExportButton action={() => exportPunchLogXlsx(date)} label="Export" />;
}
