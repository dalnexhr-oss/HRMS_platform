'use client';

// Staff-only payroll downloads for PF, ESIC, and Professional Tax.
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportPfEcr, exportEsic, exportPt } from '@/lib/actions/export';

export function StatutoryExports({
  periodMonth,
  disabled = false,
}: {
  periodMonth: string;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Statutory:
      </span>
      <XlsxExportButton action={exportPfEcr.bind(null, periodMonth)} label="PF ECR" />
      <XlsxExportButton action={exportEsic.bind(null, periodMonth)} label="ESIC .xlsx" />
      <XlsxExportButton action={exportPt.bind(null, periodMonth)} label="PT .xlsx" />
    </span>
  );
}
