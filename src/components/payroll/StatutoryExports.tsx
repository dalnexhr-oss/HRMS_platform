'use client';

// Staff-only payroll downloads for PF, ESIC, and Professional Tax.
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportPfEcr, exportEsic, exportPt } from '@/lib/actions/export';
import styles from './PayrollOverview.module.css';

function StatutoryExports({
  periodMonth,
  disabled = false,
}: {
  periodMonth: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return null;
  }
  return (
    <div className={styles.downloadGroup}>
      <span className={styles.downloadLabel}>Statutory files</span>
      <div className={styles.downloadButtons}>
        <XlsxExportButton action={exportPfEcr.bind(null, periodMonth)} label="PF ECR" />
        <XlsxExportButton action={exportEsic.bind(null, periodMonth)} label="ESIC Excel" />
        <XlsxExportButton action={exportPt.bind(null, periodMonth)} label="PT Excel" />
      </div>
    </div>
  );
}

export { StatutoryExports };
