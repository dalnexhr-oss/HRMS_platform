import styles from './PayrollOverview.module.css';
import { MonthNavigation } from '@/components/ui/MonthNavigation';
import { StatutoryExports } from './StatutoryExports';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { PayrollTable, RunActions } from './PayrollTable';
import { exportPayrollXlsx, exportAttendanceTemplateXlsx } from '@/lib/actions/export';
import type { Route } from 'next';
import type { PayrollRunView } from '@/lib/queries/payroll';
import type { PayslipRow } from '@/types/domain';
import type { PayslipAdjustments } from '@/types/payroll';

const ist = 'Asia/Kolkata';

const runStatusLabel: Record<PayrollRunView['status'], string> = {
  draft: 'Draft',
  in_review: 'In review',
  locked: 'Locked',
  paid: 'Paid',
};

function stamp(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ist,
  });
}

function monthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return periodMonth;
  }
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(date: string | null): string | null {
  if (!date) {
    return null;
  }
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function PayrollScreen({
  run,
  payslips,
  periodMonth,
  prev,
  next,
  adjustments,
  adjWindow,
}: {
  run: PayrollRunView | null;
  payslips: PayslipRow[];
  periodMonth: string;
  prev: string;
  next: string;
  adjustments: Record<string, PayslipAdjustments>;
  adjWindow: { open: string | null; close: string | null };
}) {
  const label = monthLabel(run?.periodMonth ?? periodMonth);
  const statusLabel = run ? runStatusLabel[run.status] : 'No run';

  // Show only milestones with recorded timestamps.
  const segments: Array<[string, string]> = run
    ? (
        [
          ['Month closed', stamp(run.monthClosedAt)],
          ['Drafts computed', stamp(run.draftsComputedAt)],
          ['Locked', stamp(run.lockedAt)],
          ['Paid', stamp(run.paidAt)],
        ] as Array<[string, string | null]>
      ).flatMap(([l, v]) => (v ? [[l, v] as [string, string]] : []))
    : [];

  // Show the adjustment window, if it exists.
  const openLabel = dayLabel(adjWindow.open);
  const closeLabel = dayLabel(adjWindow.close);
  if (openLabel || closeLabel) {
    segments.push([
      'Adjustments window',
      openLabel && closeLabel ? `${openLabel} – ${closeLabel}` : (openLabel ?? closeLabel)!,
    ]);
  }

  if (run?.workingDays != null) {
    segments.push(['Working days', String(run.workingDays)]);
  }

  return (
    <div className="content-container payroll-page">
      <div className="payroll-run-banner">
        <div className={styles.period}>
          <MonthNavigation
            label={label}
            previousHref={`/payroll?m=${prev}` as Route}
            nextHref={`/payroll?m=${next}` as Route}
          />
          <span className="payroll-run-status" data-status={run?.status ?? 'none'}>
            {statusLabel}
          </span>
        </div>
        <div className="payroll-run-details">
          {segments.length > 0 ? (
            segments.map(([l, v]) => (
              <span className="payroll-run-detail" key={l}>
                <span>{l}</span>
                <b>{v}</b>
              </span>
            ))
          ) : (
            <span className="payroll-run-detail">
              {run ? 'No milestones recorded yet' : `No payroll run for ${label}`}
            </span>
          )}
        </div>
        <div className="payroll-run-actions">
          <RunActions
            run={run}
            payslipCount={payslips.length}
            periodMonth={run?.periodMonth ?? periodMonth}
          />
        </div>
      </div>

      <PayrollTable
        payslips={payslips}
        run={run}
        monthLabel={label}
        adjustments={adjustments}
        downloads={
          <div className={styles.downloads} role="group" aria-label="Payroll downloads">
            <div className={styles.downloadGroup}>
              <span className={styles.downloadLabel}>Payroll files</span>
              <div className={styles.downloadButtons}>
                <XlsxExportButton
                  action={exportPayrollXlsx.bind(null, run?.periodMonth ?? periodMonth)}
                  label="Payroll Excel"
                />
                <XlsxExportButton
                  action={exportAttendanceTemplateXlsx.bind(null, run?.periodMonth ?? periodMonth)}
                  label="Attendance template"
                />
              </div>
            </div>
            <StatutoryExports
              periodMonth={run?.periodMonth ?? periodMonth}
              disabled={payslips.length === 0}
            />
          </div>
        }
      />

      <p className="text-muted payroll-note">
        Statutory lines follow the confirmed rules: PF 12% at actual Basic+DA, ESIC 0.75% below the
        ₹21,000 gross cap, PT from the slabs on the Professional tax tab for the branch’s state.
        Click a row for the full breakdown and manual adjustments.
      </p>
    </div>
  );
}

export { PayrollScreen };
