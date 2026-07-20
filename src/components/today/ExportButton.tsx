'use client';

import { useCallback, useState } from 'react';
import type { PunchLogRow } from '@/types/domain';
import { statusMeta } from '@/lib/constants';

interface ExportButtonProps {
  rows: PunchLogRow[];
  /** The punch log's business date (Asia/Kolkata, 'YYYY-MM-DD'). Passed from the
   *  server so the filename matches the data, not the viewer's local clock. */
  date: string;
  /** Set when the rows could not be loaded at all. Keeps the button from claiming
   *  "nothing to export" when the truth is that the query failed. */
  disabledReason?: string | null;
}

const HEADERS = ['Emp', 'Name', 'Branch', 'In', 'Out', 'Active', 'Status'] as const;

/** RFC 4180: wrap in quotes when the value carries a comma, quote, CR or LF; double the quotes. */
function csvCell(value: string | null): string {
  const v = value ?? '';
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows: PunchLogRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    // statusMeta gives the same label the <Stamp> shows, so the CSV reads like the table.
    const [label] = statusMeta(r.status);
    lines.push(
      [r.code, r.name, r.branch, r.in, r.out, r.active, label].map(csvCell).join(','),
    );
  }
  // CRLF + a UTF-8 BOM keep Excel happy with the ₹/·/— characters elsewhere in the app.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * Client-side CSV export of the punch log. No server round-trip and no new deps:
 * the rows are already on the page, so we just re-serialise what is rendered.
 */
export function ExportButton({ rows, date, disabledReason = null }: ExportButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const disabled = disabledReason !== null || rows.length === 0;
  const reason = disabledReason ?? (rows.length === 0 ? 'Nothing to export yet' : null);

  const onExport = useCallback(() => {
    setError(null);
    let url: string | null = null;
    try {
      const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `punch-log-${date}.csv`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      // Revoke on the next tick — revoking synchronously can cancel the download in
      // some browsers before it has read the blob.
      if (url) {
        const toRevoke = url;
        setTimeout(() => URL.revokeObjectURL(toRevoke), 0);
      }
    }
  }, [rows, date]);

  return (
    <>
      <button
        type="button"
        className="btn quiet"
        onClick={onExport}
        disabled={disabled}
        title={reason ?? `Download ${rows.length} rows as CSV`}
        style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
      >
        Export
      </button>
      {error ? (
        <span className="muted" style={{ fontSize: 12, color: 'var(--ab)' }}>
          {error}
        </span>
      ) : null}
    </>
  );
}
