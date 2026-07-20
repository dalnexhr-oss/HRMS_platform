import { PayrollTable, RunActions } from '@/components/payroll/PayrollTable';
import type { PayslipAdjustments } from '@/components/payroll/PayrollTable';
import { getPayrollRun, getPayslips, DEFAULT_PERIOD_MONTH } from '@/lib/queries';
import type { PayrollRunView } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportPayrollXlsx } from '@/lib/actions/export';
import { StatutoryExports } from '@/components/payroll/StatutoryExports';

// Timestamps are rendered on the server only, so a fixed zone keeps them stable
// and correct for the business rather than dependent on the host's TZ.
const IST = 'Asia/Kolkata';

const STATUS_LABEL: Record<PayrollRunView['status'], string> = {
  draft: 'Draft',
  in_review: 'In review',
  locked: 'Locked',
  paid: 'Paid',
};

/** timestamptz -> '30 Jun, 00:30'. null when the milestone hasn't happened. */
function stamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: IST,
  });
}

/** '2026-06-01' -> 'June 2026'. */
function monthLabel(periodMonth: string): string {
  const d = new Date(periodMonth + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** 'YYYY-MM-DD' -> '1 Jul'. Null for a null/unparseable date column. */
function dayLabel(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The run's adjustments window (payroll_runs.adjustments_open / _close).
 *
 * These columns are real (migration 0001) and populated (seed.sql seeds
 * 2026-07-01 → 2026-07-09 for the June run) — the "1–9 Jul" the prototype showed
 * was seeded data, not invention. Read directly because Core's PayrollRunView
 * doesn't carry them and queries.ts is owned elsewhere.
 *
 * Shown as INFORMATION only. Nothing in the schema enforces this window — only
 * `status` freezes adjustments — so the UI must not imply it is a hard gate.
 */
async function loadAdjustmentWindow(
  runId: string | null,
): Promise<{ open: string | null; close: string | null }> {
  if (!isSupabaseConfigured() || !runId) return { open: null, close: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('adjustments_open, adjustments_close')
    .eq('id', runId)
    .maybeSingle<{ adjustments_open: string | null; adjustments_close: string | null }>();

  if (error) {
    throw new Error(
      `PayrollPage: could not load the adjustments window: ${error.message}` +
        (error.code ? ` (${error.code})` : ''),
    );
  }
  return { open: data?.adjustments_open ?? null, close: data?.adjustments_close ?? null };
}

interface AdjustmentRow {
  id: string;
  advance_recovery: number | string | null;
  loss_damage: number | string | null;
  last_month_balance: number | string | null;
  reimbursement_bonus: number | string | null;
  remarks: string | null;
}

/**
 * Load the saved adjustments for the payslips on screen so the inputs show what
 * is actually stored instead of a cosmetic "0".
 *
 * Queried here rather than via @/lib/queries because the data contract has no
 * adjustments accessor and queries.ts is owned elsewhere. Same rule applies: a
 * failure when Supabase IS configured is surfaced, never swallowed into zeros —
 * blank adjustment boxes over a broken read would invite someone to "re-enter"
 * values that were already there and double-count them.
 */
async function loadAdjustments(payslipIds: string[]): Promise<Record<string, PayslipAdjustments>> {
  if (!isSupabaseConfigured() || payslipIds.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payslip_adjustments')
    .select('id, advance_recovery, loss_damage, last_month_balance, reimbursement_bonus, remarks')
    .in('id', payslipIds);

  if (error) {
    throw new Error(
      `PayrollPage: could not load payslip adjustments: ${error.message}` +
        (error.code ? ` (${error.code})` : ''),
    );
  }

  const map: Record<string, PayslipAdjustments> = {};
  for (const row of (data ?? []) as AdjustmentRow[]) {
    map[row.id] = {
      advanceRecovery: Number(row.advance_recovery ?? 0),
      lossDamage: Number(row.loss_damage ?? 0),
      lastMonthBalance: Number(row.last_month_balance ?? 0),
      reimbursementBonus: Number(row.reimbursement_bonus ?? 0),
      remarks: row.remarks ?? '',
    };
  }
  return map;
}

export default async function PayrollPage() {
  const periodMonth = DEFAULT_PERIOD_MONTH;

  const [run, payslips] = await Promise.all([getPayrollRun(periodMonth), getPayslips(periodMonth)]);
  const [adjustments, adjWindow] = await Promise.all([
    loadAdjustments(payslips.map((p) => p.id)),
    loadAdjustmentWindow(run?.id ?? null),
  ]);

  const label = monthLabel(run?.periodMonth ?? periodMonth);
  const statusLabel = run ? STATUS_LABEL[run.status] : 'No run';

  // Only milestones that have actually happened — a null timestamp means the
  // step hasn't occurred, so it isn't rendered. (The prototype's "Locks & pays
  // Fri 10 Jul" really is unbacked — no such column exists — and stays gone.)
  const segments: [string, string][] = run
    ? (
        [
          ['Month closed', stamp(run.monthClosedAt)],
          ['Drafts computed', stamp(run.draftsComputedAt)],
          ['Locked', stamp(run.lockedAt)],
          ['Paid', stamp(run.paidAt)],
        ] as [string, string | null][]
      ).flatMap(([l, v]) => (v ? [[l, v] as [string, string]] : []))
    : [];

  // Real, seeded data (payroll_runs.adjustments_open/_close) — informational.
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
    <div className="wrap">
      <div className="run-banner">
        <span className="state">{statusLabel.toUpperCase()}</span>
        <div className="tl">
          {segments.length > 0 ? (
            segments.map(([l, v]) => (
              <span className="seg" key={l}>
                {l} <b>&nbsp;{v}</b>
              </span>
            ))
          ) : (
            <span className="seg">
              {run ? 'No milestones recorded yet' : `No payroll run for ${label}`}
            </span>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <RunActions run={run} payslipCount={payslips.length} periodMonth={run?.periodMonth ?? periodMonth} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <XlsxExportButton
          action={exportPayrollXlsx.bind(null, run?.periodMonth ?? periodMonth)}
          label="Export payroll .xlsx"
        />
        <StatutoryExports periodMonth={run?.periodMonth ?? periodMonth} disabled={payslips.length === 0} />
      </div>

      <PayrollTable
        payslips={payslips}
        run={run}
        monthLabel={label}
        statusLabel={statusLabel}
        adjustments={adjustments}
      />

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Statutory lines follow the confirmed rules: PF 12% at actual Basic+DA, ESIC 0.75% below the
        ₹21,000 gross cap, PT by branch state (Gujarat: nil ≤ ₹12,000, ₹200 above). Click a row for
        the full breakdown and manual adjustments.
      </p>
    </div>
  );
}
