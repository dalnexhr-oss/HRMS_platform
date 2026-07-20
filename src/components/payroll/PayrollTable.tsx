'use client';

import { Fragment, useState, useTransition, useActionState } from 'react';
import type { ChangeEvent } from 'react';
import { inr } from '@/lib/format';
import { computeRun, lockRun, markRunPaid, openRun, saveAdjustments } from '@/lib/actions/payroll';
import { printPayslip } from '@/lib/payslip-print';
import type { PayslipRow } from '@/types/domain';
import type { PayrollRunView } from '@/lib/queries';

type ActionResult = { ok: boolean; error?: string };

/** One payslip's manual adjustments, as loaded by the page. */
export interface PayslipAdjustments {
  advanceRecovery: number;
  lossDamage: number;
  lastMonthBalance: number;
  reimbursementBonus: number;
  remarks: string;
}

export const EMPTY_ADJUSTMENTS: PayslipAdjustments = {
  advanceRecovery: 0,
  lossDamage: 0,
  lastMonthBalance: 0,
  reimbursementBonus: 0,
  remarks: '',
};

/** A locked or paid run is history — nothing about it may be recomputed. */
function isFrozen(run: PayrollRunView | null): boolean {
  return run ? run.status === 'locked' || run.status === 'paid' : true;
}

/**
 * Calendar days in the run's month — the denominator payable days are counted
 * against (the register's "to pay for" column: working days + OH + WO).
 *
 * Derived, not assumed: this used to be a hardcoded "of 30", which is simply
 * wrong for any 31-day month. Returns null when there's no run to derive it
 * from, in which case the denominator is omitted rather than guessed.
 */
function daysInPeriod(periodMonth: string | null | undefined): number | null {
  if (!periodMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(periodMonth);
  if (!m) return null;
  // Day 0 of the next month === last day of this one.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDate();
}

// ============================================================ run actions ===
// Lives here (not in the page) because it needs handlers; the page keeps the
// .run-banner markup and drops this in where the two buttons used to be.

export function RunActions({
  run,
  payslipCount,
  periodMonth,
}: {
  run: PayrollRunView | null;
  payslipCount: number;
  /** The month the page is showing, so a run can be opened when none exists. */
  periodMonth: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // No run for this month yet — offer to start one rather than only disabling
  // every action (a new month previously needed a manual SQL insert).
  if (!run) {
    return (
      <>
        <button
          className="btn primary"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await openRun(periodMonth);
              if (!res.ok) setError(res.error ?? 'Could not start the payroll run.');
            });
          }}
        >
          {pending ? 'Starting…' : 'Start payroll run'}
        </button>
        {error && (
          <div className="login-error" style={{ flexBasis: '100%', margin: '4px 0 0' }}>
            {error}
          </div>
        )}
      </>
    );
  }

  const frozen = isFrozen(run);
  // Locking is irreversible — there is no unlock function in the schema, and
  // fn_compute_run raises on a locked run. Locking a run with no payslips would
  // therefore freeze the month into a state where payslips can NEVER be built.
  const nothingToLock = payslipCount === 0;

  const call = (fn: (runId: string) => Promise<ActionResult>, confirmMessage?: string) => {
    if (!run) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(null);
    startTransition(async () => {
      const res = await fn(run.id);
      if (!res.ok) setError(res.error ?? 'The action failed for an unknown reason.');
    });
  };

  const noRun = 'There is no payroll run for this month yet.';

  return (
    <>
      <button
        className="btn"
        disabled={!run || frozen || pending}
        title={!run ? noRun : frozen ? `This run is ${run.status} — drafts can no longer be recomputed.` : undefined}
        onClick={() => call(computeRun)}
      >
        {pending ? 'Working…' : 'Recompute drafts'}
      </button>

      <button
        className="btn primary"
        disabled={!run || frozen || nothingToLock || pending}
        title={
          !run
            ? noRun
            : frozen
              ? `This run is already ${run.status}.`
              : nothingToLock
                ? 'This run has no payslips yet. Locking is irreversible, so it would freeze the ' +
                  'month with nothing in it — recompute drafts first.'
                : undefined
        }
        onClick={() =>
          call(
            lockRun,
            `Lock this payroll run and generate payslips for ${payslipCount} ` +
              `${payslipCount === 1 ? 'employee' : 'employees'}?\n\n` +
              'This cannot be undone: once locked, drafts can no longer be recomputed and ' +
              'adjustments are frozen.',
          )
        }
      >
        Lock &amp; generate payslips
      </button>

      {run?.status === 'locked' && (
        <button
          className="btn"
          disabled={pending}
          onClick={() => call(markRunPaid, 'Mark this run — and every payslip in it — as paid?')}
        >
          Mark paid
        </button>
      )}

      {error && (
        <div className="login-error" style={{ flexBasis: '100%', margin: '4px 0 0' }}>
          {error}
        </div>
      )}
    </>
  );
}

// ============================================================ payroll table ===

export function PayrollTable({
  payslips,
  run,
  monthLabel,
  statusLabel,
  adjustments,
}: {
  payslips: PayslipRow[];
  run: PayrollRunView | null;
  monthLabel: string;
  statusLabel: string;
  adjustments: Record<string, PayslipAdjustments>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const sum = (k: keyof PayslipRow) => payslips.reduce((a, p) => a + (p[k] as number), 0);

  const totals: [string, string][] = [
    ['Total net payout', inr(sum('netPayable'))],
    ['Earned gross', inr(sum('earnedGross'))],
    ['PF (emp + er)', inr(sum('pfEmployee') + sum('pfEmployer'))],
    ['ESIC (emp + er)', inr(sum('esicEmployee') + sum('esicEmployer'))],
    ['Professional tax', inr(sum('professionalTax'))],
  ];

  const frozen = isFrozen(run);
  const payslipLabel = run
    ? { draft: 'Draft', in_review: 'Draft', locked: 'Locked', paid: 'Paid' }[run.status]
    : 'No run';

  return (
    <>
      <div className="totals">
        {totals.map(([l, v]) => (
          <div className="card" key={l}>
            <div className="lab">{l}</div>
            <div className="val">{v}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="hd">
          <h3>Payslips — {monthLabel}</h3>
          <span className="folio">
            {payslips.length} {payslips.length === 1 ? 'employee' : 'employees'} ·{' '}
            {statusLabel.toLowerCase()}
          </span>
        </div>

        {payslips.length === 0 ? (
          <div className="bd">
            <p className="muted">
              {run
                ? 'This run has no payslips yet — use “Recompute drafts” to build them.'
                : `No payroll run exists for ${monthLabel} yet.`}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Emp</th>
                  <th>Name</th>
                  <th>Branch</th>
                  <th className="right">Payable days</th>
                  <th className="right">Earned gross</th>
                  <th className="right">Hours shortfall</th>
                  <th className="right">PF</th>
                  <th className="right">ESIC</th>
                  <th className="right">PT</th>
                  <th className="right">Net payable</th>
                  <th>Payslip</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => setOpen((o) => (o === p.id ? null : p.id))}
                    >
                      <td className="mono muted">{p.code}</td>
                      <td>
                        <b>{p.name}</b>
                      </td>
                      <td>{p.branch}</td>
                      <td className="right mono">{p.payableDays}</td>
                      <td className="right mono">{inr(p.earnedGross)}</td>
                      <td
                        className="right mono"
                        style={{ color: p.shortfallAmount ? 'var(--hd)' : 'var(--ink-3)' }}
                      >
                        {p.shortfallAmount ? '-' + inr(p.shortfallAmount) : '—'}
                      </td>
                      <td className="right mono">{inr(p.pfEmployee)}</td>
                      <td className="right mono">{p.esicEmployee ? inr(p.esicEmployee) : '—'}</td>
                      <td className="right mono">{inr(p.professionalTax)}</td>
                      <td
                        className="right mono"
                        style={{ fontWeight: 700, color: 'var(--brand-deep)' }}
                      >
                        {inr(p.netPayable)}
                      </td>
                      <td>
                        <span className="pill wapill">{payslipLabel}</span>
                      </td>
                    </tr>
                    {open === p.id && (
                      <PayExpand
                        p={p}
                        adj={adjustments[p.id] ?? EMPTY_ADJUSTMENTS}
                        frozen={frozen}
                        runStatus={run?.status ?? null}
                        daysInMonth={daysInPeriod(run?.periodMonth)}
                      />
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function PayExpand({
  p,
  adj,
  frozen,
  runStatus,
  daysInMonth,
}: {
  p: PayslipRow;
  adj: PayslipAdjustments;
  frozen: boolean;
  runStatus: PayrollRunView['status'] | null;
  daysInMonth: number | null;
}) {
  return (
    <tr className="exp">
      <td colSpan={11}>
        <div className="exp-grid">
          <div className="exp-col">
            <h4>
              Earnings — {p.payableDays} payable days
              {daysInMonth ? ` of ${daysInMonth}` : ''}
            </h4>
            <Kv label="Per-day rate" value={inr(p.perDayRate)} />
            <Kv label="Basic (earned)" value={inr(p.basicEarned)} />
            <Kv label="HRA (earned)" value={inr(p.hraEarned)} />
            <Kv label="Special allowance (earned)" value={inr(p.specialEarned)} />
            <Kv label="Earned gross" value={inr(p.earnedGross)} total />
          </div>
          <div className="exp-col">
            <h4>Deductions</h4>
            <Kv
              label={`Hours shortfall (${p.shortfallMinutes} min)`}
              value={p.shortfallAmount ? inr(p.shortfallAmount) : '—'}
            />
            <Kv label="PF · 12% of Basic+DA at actual" value={inr(p.pfEmployee)} />
            <Kv
              label={`ESIC · 0.75% ${p.esicEmployee ? '(eligible)' : '(above ₹21k cap)'}`}
              value={p.esicEmployee ? inr(p.esicEmployee) : '—'}
            />
            <Kv label={`Professional tax · ${p.state}`} value={inr(p.professionalTax)} />
            <Kv label="Net payable" value={inr(p.netPayable)} total />
            <div className="kv muted" style={{ fontSize: 11 }}>
              <span>
                Employer side: PF {inr(p.pfEmployer)} · ESIC{' '}
                {p.esicEmployer ? inr(p.esicEmployer) : '—'}
              </span>
            </div>
          </div>
          <div className="exp-col adj">
            {/* key: re-seed the controlled inputs when a different payslip opens */}
            <AdjForm key={p.id} p={p} adj={adj} frozen={frozen} runStatus={runStatus} />
          </div>
        </div>
      </td>
    </tr>
  );
}

function AdjForm({
  p,
  adj,
  frozen,
  runStatus,
}: {
  p: PayslipRow;
  adj: PayslipAdjustments;
  frozen: boolean;
  runStatus: PayrollRunView['status'] | null;
}) {
  const [form, setForm] = useState({
    advance_recovery: String(adj.advanceRecovery),
    loss_damage: String(adj.lossDamage),
    last_month_balance: String(adj.lastMonthBalance),
    reimbursement_bonus: String(adj.reimbursementBonus),
    remarks: adj.remarks,
  });

  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => saveAdjustments(formData),
    {},
  );

  const set =
    (k: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form action={action}>
      <h4>
        Manual adjustments
        {frozen ? ` — frozen (run ${runStatus ?? 'unavailable'})` : ''}
      </h4>
      <input type="hidden" name="payslipId" value={p.id} />

      <AdjRow
        label="Advance recovery"
        name="advance_recovery"
        value={form.advance_recovery}
        onChange={set('advance_recovery')}
        readOnly={frozen}
      />
      <AdjRow
        label="Loss / damage"
        name="loss_damage"
        value={form.loss_damage}
        onChange={set('loss_damage')}
        readOnly={frozen}
      />
      <AdjRow
        label="Last month balance (±)"
        name="last_month_balance"
        value={form.last_month_balance}
        onChange={set('last_month_balance')}
        readOnly={frozen}
      />
      <AdjRow
        label="Reimbursement / bonus"
        name="reimbursement_bonus"
        value={form.reimbursement_bonus}
        onChange={set('reimbursement_bonus')}
        readOnly={frozen}
      />

      <div className="kv">
        <span style={{ alignSelf: 'center' }}>Remarks</span>
        <input
          name="remarks"
          value={form.remarks}
          onChange={set('remarks')}
          readOnly={frozen}
          style={{ width: 150, textAlign: 'left' }}
        />
      </div>

      {state.error && (
        <div className="login-error" style={{ margin: '10px 0 0' }}>
          {state.error}
        </div>
      )}
      {state.ok && !pending && (
        <div className="hint" style={{ marginTop: 10 }}>
          ✓&nbsp; Adjustments saved and the payslip recomputed.
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (!printPayslip(p)) {
              alert('Your browser blocked the payslip window. Allow pop-ups for this site and try again.');
            }
          }}
          title="Open a printable payslip (Save as PDF from the print dialog)"
        >
          Payslip PDF
        </button>
        {!frozen && (
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </form>
  );
}

function Kv({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`kv${total ? ' total' : ''}`}>
      <span>{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function AdjRow({
  label,
  name,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  readOnly: boolean;
}) {
  return (
    <div className="kv">
      <span>{label}</span>
      <input
        name={name}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        inputMode="decimal"
        autoComplete="off"
      />
    </div>
  );
}
