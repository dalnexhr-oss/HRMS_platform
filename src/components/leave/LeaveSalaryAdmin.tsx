'use client';

// ============================================================================
// The leave-salary working screen (replaces the PL/CL/SL balances admin).
//
// One row per employee, mirroring the owner's Excel: HR types the before/after
// salaries, presence comes from the register, and the payable amounts follow
// the formula — (salary/2) × months/12 × present/calendar — live while a row
// is a draft, frozen once it is finalized. The paid-leave pool (15 days/yr)
// keeps a compact card below: approvals still deduct from it, so HR still
// needs the provision button and an audited correction path.
// ============================================================================
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@/lib/format';
import {
  computeLeaveSalary,
  effectiveFigures,
  type LeaveSalaryResult,
} from '@/lib/leave-salary';
import type { LeaveSalaryViewRow } from '@/lib/leave-salary-view';
import {
  saveLeaveSalaryWorking,
  finalizeLeaveSalary,
  reopenLeaveSalary,
  markLeaveSalaryPaid,
} from '@/lib/actions/leave-salary';
import { provisionLeaveYear, adjustLeaveBalance } from '@/lib/actions/leave';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { LeaveBalanceAdminRow } from '@/lib/queries';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--ink-2)',
  finalized: 'var(--lm)',
  paid: 'var(--p)',
};

export function LeaveSalaryAdmin({
  year,
  migrated,
  rows,
  pool,
  exportSlot,
}: {
  year: number;
  migrated: boolean;
  rows: LeaveSalaryViewRow[];
  pool: LeaveBalanceAdminRow[];
  exportSlot?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast(res.error ?? 'The action failed.', 'error');
      else {
        toast(okMsg, 'success');
        router.refresh();
      }
    });
  }

  async function onProvision() {
    const ok = await confirm({
      title: `Open leave year ${year}`,
      message:
        `Credit every employee still on the roster their 15 days of paid leave for ${year}?\n\n` +
        `Safe to re-run — anyone already provisioned for ${year} is skipped, never credited twice.`,
      confirmLabel: 'Provision year',
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await provisionLeaveYear(year);
      if (!res.ok) toast(res.error ?? 'Provisioning failed.', 'error');
      else {
        toast(
          res.created === 0
            ? `Nothing to do — ${year} is already provisioned for everyone.`
            : `Provisioned ${res.created} paid-leave row(s) for ${year}.`,
          'success',
        );
        router.refresh();
      }
    });
  }

  const grandTotal = rows.reduce(
    (a, r) => a + effectiveFigures(r.working, r.live).total,
    0,
  );

  return (
    <div className="wrap grid">
      {confirmDialog}
      {toastNode}

      <div className="card">
        <div className="hd">
          <h3>Leave salary working · {year}</h3>
          <span className="folio">
            {rows.length} employee{rows.length === 1 ? '' : 's'} · total {inr(grandTotal)}
          </span>
          <span style={{ flex: 1 }} />
          {/* Year switcher: the working is strictly per calendar year. */}
          <button className="btn quiet" disabled={pending} onClick={() => router.push(`/leave?y=${year - 1}`)}>
            ← {year - 1}
          </button>
          <button className="btn quiet" disabled={pending} onClick={() => router.push(`/leave?y=${year + 1}`)}>
            {year + 1} →
          </button>
          {exportSlot}
        </div>

        {!migrated && (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>
              Leave salary is not set up on this database yet — apply migration{' '}
              <b>0038_leave_salary.sql</b>. The figures below are computed live and correct, but
              nothing can be saved until then.
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>No employees on the roster for {year}.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="right">Salary before</th>
                  <th className="right">Salary after</th>
                  <th>Increment from</th>
                  <th className="right">Present · before</th>
                  <th className="right">Present · after</th>
                  <th className="right">Payable · before</th>
                  <th className="right">Payable · after</th>
                  <th className="right">Total</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <WorkingRow
                    key={r.employeeId}
                    year={year}
                    row={r}
                    migrated={migrated}
                    pending={pending}
                    onAction={run}
                    onConfirmPaid={async (name, total) =>
                      confirm({
                        title: 'Mark leave salary paid',
                        message:
                          `Record ${inr(total)} as paid to ${name} for ${year}?\n\n` +
                          `This is final — a paid working cannot be reopened or edited.`,
                        confirmLabel: 'Mark paid',
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="bd">
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Formula per period: (monthly salary ÷ 2) × months ÷ 12 × present days ÷ calendar days.
            Week-offs, holidays and comp-offs count as present; a half day counts 0.5; absences and
            leave days count 0. Salaries pre-fill from the employee record — correct the
            pre-appraisal figure by hand where it differs.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Paid-leave pool · {year}</h3>
          <span className="folio">15 days a year · approvals deduct from this</span>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={onProvision} disabled={pending}>
            {pending ? 'Working…' : `Open leave year ${year}`}
          </button>
        </div>
        {pool.length === 0 ? (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>
              No paid-leave balances for {year} yet. Use <b>Open leave year</b> to credit everyone —
              until then, approving leave deducts nothing.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="right">Days left</th>
                  <th>Adjust</th>
                </tr>
              </thead>
              <tbody>
                {pool.map((b) => (
                  <tr key={b.employeeId}>
                    <td>
                      <b>{b.name}</b>{' '}
                      <span className="mono muted" style={{ fontSize: 11 }}>{b.code}</span>
                    </td>
                    <td className="right mono" style={{ color: b.balance < 0 ? 'var(--ab)' : undefined }}>
                      {b.balance}
                    </td>
                    <td>
                      <AdjustForm
                        employeeId={b.employeeId}
                        year={year}
                        disabled={pending}
                        onDone={(res) => {
                          if (!res.ok) toast(res.error ?? 'The adjustment failed.', 'error');
                          else {
                            toast('Balance adjusted.', 'success');
                            router.refresh();
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- working row ---

function WorkingRow({
  year,
  row,
  migrated,
  pending,
  onAction,
  onConfirmPaid,
}: {
  year: number;
  row: LeaveSalaryViewRow;
  migrated: boolean;
  pending: boolean;
  onAction: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => void;
  onConfirmPaid: (name: string, total: number) => Promise<boolean>;
}) {
  const status = row.working?.status ?? null;
  const locked = status === 'finalized' || status === 'paid';

  // Inputs live as strings so a half-typed number doesn't snap to 0.
  const [before, setBefore] = useState(String(row.salaryBefore || ''));
  const [after, setAfter] = useState(String(row.salaryAfter || ''));
  const [incMonth, setIncMonth] = useState(row.incrementMonth);
  const [remarks, setRemarks] = useState(row.remarks);
  const [open, setOpen] = useState(false);

  const salaryBefore = Number(before);
  const salaryAfter = Number(after);
  const valid =
    Number.isFinite(salaryBefore) && salaryBefore >= 0 &&
    Number.isFinite(salaryAfter) && salaryAfter >= 0;

  // Live figures follow the inputs as HR types; locked rows show the snapshot.
  const live: LeaveSalaryResult = useMemo(
    () =>
      computeLeaveSalary({
        year,
        salaryBefore: valid ? salaryBefore : 0,
        salaryAfter: valid ? salaryAfter : 0,
        incrementMonth: incMonth,
        monthlyPresence: row.monthlyPresence,
      }),
    [year, salaryBefore, salaryAfter, incMonth, row.monthlyPresence, valid],
  );
  const fig = locked ? effectiveFigures(row.working, row.live) : effectiveFigures(null, live);

  const dirty =
    !locked &&
    (salaryBefore !== row.salaryBefore ||
      salaryAfter !== row.salaryAfter ||
      incMonth !== row.incrementMonth ||
      remarks.trim() !== row.remarks.trim() ||
      row.working === null);

  const inputStyle = { width: 92, padding: '4px 6px', textAlign: 'right' as const };

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <td>
          <b>{row.name}</b>{' '}
          <span className="mono muted" style={{ fontSize: 11 }}>{row.code}</span>
          {!row.onRoster && (
            <div className="muted" style={{ fontSize: 11 }}>no longer on the roster</div>
          )}
          {row.drift && (
            <div style={{ fontSize: 11, color: 'var(--lm)' }}>
              attendance changed since {status} — reopen to recompute
            </div>
          )}
        </td>
        <td className="right" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <span className="mono">{inr(row.salaryBefore)}</span>
          ) : (
            <input
              className="mono"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
              style={inputStyle}
              aria-label={`${row.name}: monthly salary before the increment`}
            />
          )}
        </td>
        <td className="right" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <span className="mono">{inr(row.salaryAfter)}</span>
          ) : (
            <input
              className="mono"
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              style={inputStyle}
              aria-label={`${row.name}: monthly salary after the increment`}
            />
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {locked ? (
            MONTHS[incMonth - 1]
          ) : (
            <select
              value={incMonth}
              onChange={(e) => setIncMonth(Number(e.target.value))}
              aria-label={`${row.name}: month the increment takes effect`}
            >
              {MONTHS.map((m, ix) => (
                <option key={m} value={ix + 1}>{m}</option>
              ))}
            </select>
          )}
        </td>
        <td className="right mono">
          {fig.presentP1}
          <span className="muted">/{fig.calendarDaysP1}</span>
        </td>
        <td className="right mono">
          {fig.presentP2}
          <span className="muted">/{fig.calendarDaysP2}</span>
        </td>
        <td className="right mono">{inr(fig.amountP1)}</td>
        <td className="right mono">{inr(fig.amountP2)}</td>
        <td className="right mono" style={{ fontWeight: 700 }}>{inr(fig.total)}</td>
        <td>
          <span className="pill" style={{ borderColor: 'var(--line-2)', color: STATUS_COLOR[status ?? 'draft'] }}>
            {status ?? 'unsaved'}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {!locked && (
              <button
                className="btn quiet"
                disabled={pending || !migrated || !valid || !dirty}
                title={
                  !migrated ? 'Apply migration 0038 first'
                  : !valid ? 'Enter both salaries'
                  : !dirty ? 'Nothing changed'
                  : undefined
                }
                onClick={() =>
                  onAction(
                    () =>
                      saveLeaveSalaryWorking({
                        employeeId: row.employeeId,
                        year,
                        salaryBefore,
                        salaryAfter,
                        incrementMonth: incMonth,
                        remarks,
                      }),
                    'Working saved.',
                  )
                }
              >
                Save
              </button>
            )}
            {status === 'draft' && !dirty && (
              <button
                className="btn quiet"
                disabled={pending}
                onClick={() => onAction(() => finalizeLeaveSalary(row.working!.id), 'Working finalized.')}
              >
                Finalize
              </button>
            )}
            {status === 'finalized' && (
              <>
                <button
                  className="btn quiet"
                  disabled={pending}
                  onClick={() => onAction(() => reopenLeaveSalary(row.working!.id), 'Working reopened for editing.')}
                >
                  Reopen
                </button>
                <button
                  className="btn quiet"
                  disabled={pending}
                  onClick={async () => {
                    if (!(await onConfirmPaid(row.name, fig.total))) return;
                    onAction(() => markLeaveSalaryPaid(row.working!.id), 'Leave salary marked paid.');
                  }}
                >
                  Mark paid
                </button>
              </>
            )}
            {status === 'paid' && <span className="muted">settled</span>}
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={11} style={{ background: 'var(--paper-2, #fafaf8)' }}>
            <Breakdown
              year={year}
              salaryBefore={locked ? row.salaryBefore : salaryBefore}
              salaryAfter={locked ? row.salaryAfter : salaryAfter}
              incMonth={incMonth}
              fig={fig}
              remarks={remarks}
              locked={locked}
              onRemarks={setRemarks}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** The Excel's line-by-line working for one employee, expanded under the row. */
function Breakdown({
  year,
  salaryBefore,
  salaryAfter,
  incMonth,
  fig,
  remarks,
  locked,
  onRemarks,
}: {
  year: number;
  salaryBefore: number;
  salaryAfter: number;
  incMonth: number;
  fig: ReturnType<typeof effectiveFigures>;
  remarks: string;
  locked: boolean;
  onRemarks: (v: string) => void;
}) {
  const monthsP1 = incMonth - 1;
  const monthsP2 = 12 - monthsP1;
  const entitled = (salary: number, months: number) =>
    Math.round((salary / 2) * (months / 12) * 100) / 100;

  const line = (label: string, value: string) => (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
      <span className="muted">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );

  const p1Range = monthsP1 > 0 ? `Jan – ${MONTHS[monthsP1 - 1].slice(0, 3)}` : '—';
  const p2Range = `${MONTHS[incMonth - 1].slice(0, 3)} – Dec`;

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', padding: '10px 4px', fontSize: 12.5 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Before increment · {p1Range} {year}</div>
        {line('Monthly salary', inr(salaryBefore))}
        {line('Leave salary (½ month)', inr(salaryBefore / 2))}
        {line(`Entitled for ${monthsP1} month${monthsP1 === 1 ? '' : 's'}`, inr(entitled(salaryBefore, monthsP1)))}
        {line('Days present / calendar', `${fig.presentP1} / ${fig.calendarDaysP1}`)}
        {line('Payable', inr(fig.amountP1))}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>After increment · {p2Range} {year}</div>
        {line('Monthly salary', inr(salaryAfter))}
        {line('Leave salary (½ month)', inr(salaryAfter / 2))}
        {line(`Entitled for ${monthsP2} month${monthsP2 === 1 ? '' : 's'}`, inr(entitled(salaryAfter, monthsP2)))}
        {line('Days present / calendar', `${fig.presentP2} / ${fig.calendarDaysP2}`)}
        {line('Payable', inr(fig.amountP2))}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Total · {inr(fig.total)}</div>
        {locked ? (
          remarks ? <p style={{ margin: 0 }}>{remarks}</p> : <p className="muted" style={{ margin: 0 }}>No remarks.</p>
        ) : (
          <textarea
            value={remarks}
            onChange={(e) => onRemarks(e.target.value)}
            placeholder="Remarks (saved with the working)"
            rows={3}
            style={{ width: '100%', padding: 6 }}
            aria-label="Remarks for this working"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pool card ---

/** Inline paid-leave credit/debit. A reason is mandatory — the audit row requires it. */
function AdjustForm({
  employeeId,
  year,
  disabled,
  onDone,
}: {
  employeeId: string;
  year: number;
  disabled: boolean;
  onDone: (res: { ok: boolean; error?: string }) => void;
}) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = delta.trim() !== '' && Number(delta) !== 0 && reason.trim() !== '';

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        className="mono"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        placeholder="±days"
        style={{ width: 64 }}
        aria-label="Days to credit or debit"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        style={{ width: 140 }}
        aria-label="Reason for the adjustment"
      />
      <button
        className="btn quiet"
        disabled={disabled || busy || !ready}
        title={!ready ? 'Enter a non-zero day count and a reason' : undefined}
        onClick={async () => {
          setBusy(true);
          const res = await adjustLeaveBalance({
            employeeId,
            year,
            delta: Number(delta),
            reason: reason.trim(),
          });
          setBusy(false);
          if (res.ok) {
            setDelta('');
            setReason('');
          }
          onDone(res);
        }}
      >
        {busy ? '…' : 'Apply'}
      </button>
    </div>
  );
}
