'use client';

import type { PunchLogRow } from '@/types/domain';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportPunchLogXlsx } from '@/lib/actions/export';

interface ExportButtonProps {
  /** Only used to disable the button before the server round-trip — the export
   *  itself re-queries on the server (punchLogWorkbook), like every other export. */
  rows: PunchLogRow[];
  /** The punch log's business date (Asia/Kolkata, 'YYYY-MM-DD'). Passed from the
   *  server so the filename matches the data, not the viewer's local clock. */
  date: string;
  /** Set when the rows could not be loaded at all. Keeps the button from claiming
   *  "nothing to export" when the truth is that the query failed. */
  disabledReason?: string | null;
}

/**
 * Punch-log export. Was a client-built CSV; now a branded .xlsx via the same
 * Server Action + XlsxExportButton path every other export uses, so the file
 * carries the Dalnex letterhead.
 */
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
