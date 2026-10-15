'use client';

// Leave-salary workings by employee. Drafts recalculate from salaries and register attendance;
// finalized rows use saved figures. The paid-leave pool below supports annual provisioning and
// audited adjustments.
import { inr } from '@/lib/display-formatting';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { computeLeaveSalary, effectiveFigures } from '@/lib/leave-salary/leave-salary';
import { provisionLeaveYear, adjustLeaveBalance } from '@/lib/actions/leave';
import {saveLeaveSalaryWorking,finalizeLeaveSalary,reopenLeaveSalary,markLeaveSalaryPaid } from '@/lib/actions/leave-salary';
import type { LeaveSalaryResult } from '@/lib/leave-salary/leave-salary';
import type { ReactNode } from 'react';
import type { LeaveSalaryViewRow } from '@/lib/leave-salary/leave-salary-view';
import type { LeaveBalanceAdminRow } from '@/lib/queries/leave-salary';

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const statusColor: Record<string, string> = {
  draft: 'var(--text-secondary)',
  finalized: 'var(--attendance-late)',
  paid: 'var(--attendance-present)',
};

function LeaveSalaryAdmin({
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
  const { showNotification, notificationContainer } = useNotifications();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        showNotification(res.error ?? 'The action failed.', 'error');
      } else {
        showNotification(okMsg, 'success');
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
    if (!ok) {
      return;
    }
    startTransition(async () => {
      const res = await provisionLeaveYear(year);
      if (!res.ok) {
        showNotification(res.error ?? 'Provisioning failed.', 'error');
      } else {
        showNotification(
          res.created === 0
            ? `Nothing to do — ${year} is already provisioned for everyone.`
            : `Provisioned ${res.created} paid-leave row(s) for ${year}.`,
          'success',
        );
        router.refresh();
      }
    });
  }

  const grandTotal = rows.reduce((a, r) => a + effectiveFigures(r.working, r.live).total, 0);

  return (
    <div className="content-container grid leave-salary-page">
      {confirmDialog}
      {notificationContainer}

      <div className="card">
        <div className="leave-salary-header">
          <div className="leave-salary-heading">
            <div className="leave-salary-title-row">
              <h3>Leave salary working</h3>
              <span className="leave-salary-year">{year}</span>
            </div>
            <div className="leave-salary-summary">
              <span>
                {rows.length} employee{rows.length === 1 ? '' : 's'}
              </span>
              <span className="leave-salary-total">
                Total leave salary <strong>{inr(grandTotal)}</strong>
              </span>
            </div>
          </div>
          <div className="leave-salary-actions">
            {/* Year switcher: the working is strictly per calendar year. */}
            <button
              type="button"
              className="button"
              aria-label={`View leave salary for ${year - 1}`}
              disabled={pending}
              onClick={() => router.push(`/leave-salary?y=${year - 1}`)}
            >
              ← {year - 1}
            </button>
            <button
              type="button"
              className="button"
              aria-label={`View leave salary for ${year + 1}`}
              disabled={pending}
              onClick={() => router.push(`/leave-salary?y=${year + 1}`)}
            >
              {year + 1} →
            </button>
            {exportSlot}
          </div>
        </div>

        {!migrated && (
          <div className="card-body">
            <p className="text-muted leave-salary-message">
              Leave salary is not set up on this database yet. The figures below are computed live
              and correct, but nothing can be saved until the database is configured by an
              administrator.
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="card-body">
            <p className="text-muted leave-salary-message">
              No employees on the roster for {year}.
            </p>
          </div>
        ) : (
          <div className="leave-salary-table-wrap">
            <table className="leave-salary-working-table" aria-label={`Leave salary working for ${year}`}>
              <colgroup span={1} />
              <colgroup span={2} />
              <colgroup span={1} />
              <colgroup span={2} />
              <colgroup span={2} />
              <colgroup span={1} />
              <colgroup span={1} />
              <colgroup span={1} />
              <thead>
                <tr className="leave-salary-column-groups">
                  <th scope="col" rowSpan={2}>
                    Employee
                  </th>
                  <th scope="colgroup" colSpan={2} className="leave-salary-group-title">
                    Monthly salary
                  </th>
                  <th scope="col" rowSpan={2}>
                    Increment from
                  </th>
                  <th scope="colgroup" colSpan={2} className="leave-salary-group-title">
                    Present / calendar days
                  </th>
                  <th scope="colgroup" colSpan={2} className="leave-salary-group-title">
                    Leave salary payable
                  </th>
                  <th scope="col" rowSpan={2} className="text-right">
                    Total
                  </th>
                  <th scope="col" rowSpan={2}>
                    Status
                  </th>
                  <th scope="col" rowSpan={2}>
                    Actions
                  </th>
                </tr>
                <tr className="leave-salary-column-periods">
                  <th scope="col" className="text-right">
                    Before increment
                  </th>
                  <th scope="col" className="text-right">
                    After increment
                  </th>
                  <th scope="col" className="text-right">
                    Before increment
                  </th>
                  <th scope="col" className="text-right">
                    After increment
                  </th>
                  <th scope="col" className="text-right">
                    Before increment
                  </th>
                  <th scope="col" className="text-right">
                    After increment
                  </th>
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
        <div className="card-body">
          <p className="text-muted leave-salary-note">
            Formula per period: (monthly salary ÷ 2) × months ÷ 12 × present days ÷ calendar days.
            Week-offs, holidays and comp-offs count as present; a half day counts 0.5; absences and
            leave days count 0. Salaries pre-fill from the employee record — correct the
            pre-appraisal figure by hand where it differs. The ÷ days denominator is editable too:
            type a day count to override it, or leave the box blank to use the period&rsquo;s real
            calendar days. Present days always come from the attendance register.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Paid-leave pool · {year}</h3>
          <span className="card-caption">15 days a year · approvals deduct from this</span>
          <span className="leave-salary-spacer" />
          <button className="button primary" onClick={onProvision} disabled={pending}>
            {pending ? 'Working…' : `Open leave year ${year}`}
          </button>
        </div>
        {pool.length === 0 ? (
          <div className="card-body">
            <p className="text-muted leave-salary-message">
              No paid-leave balances for {year} yet. Use <b>Open leave year</b> to credit everyone —
              until then, approving leave deducts nothing.
            </p>
          </div>
        ) : (
          <div className="leave-salary-table-wrap">
            <table className="leave-salary-pool-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="text-right">Days left</th>
                  <th>Adjust</th>
                </tr>
              </thead>
              <tbody>
                {pool.map((b) => (
                  <tr key={b.employeeId}>
                    <td>
                      <b>{b.name}</b>{' '}
                      <span className="text-monospace text-muted leave-salary-detail">
                        {b.code}
                      </span>
                    </td>
                    <td
                      className="text-right text-monospace"
                      style={{ color: b.balance < 0 ? 'var(--attendance-absent)' : undefined }}
                    >
                      {b.balance}
                    </td>
                    <td>
                      <AdjustForm
                        employeeId={b.employeeId}
                        year={year}
                        disabled={pending}
                        onDone={(res) => {
                          if (!res.ok) {
                            showNotification(res.error ?? 'The adjustment failed.', 'error');
                          } else {
                            showNotification('Balance adjusted.', 'success');
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

// working row

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
  const [salaryBeforeInput, setSalaryBeforeInput] = useState(String(row.salaryBefore || ''));
  const [salaryAfterInput, setSalaryAfterInput] = useState(String(row.salaryAfter || ''));
  const [incrementMonth, setIncrementMonth] = useState(row.incrementMonth);
  const [remarks, setRemarks] = useState(row.remarks);
  // Blank denominator overrides use the actual calendar-day count.
  const [daysBeforeIncrementInput, setDaysBeforeIncrementInput] = useState(
    row.calendarDaysP1Override != null ? String(row.calendarDaysP1Override) : '',
  );
  const [daysAfterIncrementInput, setDaysAfterIncrementInput] = useState(
    row.calendarDaysP2Override != null ? String(row.calendarDaysP2Override) : '',
  );
  const [open, setOpen] = useState(false);

  const salaryBefore = Number(salaryBeforeInput);
  const salaryAfter = Number(salaryAfterInput);
  const valid =
    Number.isFinite(salaryBefore) &&
    salaryBefore >= 0 &&
    Number.isFinite(salaryAfter) &&
    salaryAfter >= 0;

  const overrideOf = (raw: string): number | null => {
    const s = raw.trim();
    if (!s) {
      return null;
    }
    const n = Math.round(Number(s));
    return Number.isFinite(n) && n >= 1 && n <= 366 ? n : null;
  };
  const p1Override = overrideOf(daysBeforeIncrementInput);
  const p2Override = overrideOf(daysAfterIncrementInput);

  // Live figures follow the inputs as HR types; locked rows show the snapshot.
  const live: LeaveSalaryResult = useMemo(
    () =>
      computeLeaveSalary({
        year,
        salaryBefore: valid ? salaryBefore : 0,
        salaryAfter: valid ? salaryAfter : 0,
        incrementMonth,
        monthlyPresence: row.monthlyPresence,
        calendarDaysP1Override: p1Override,
        calendarDaysP2Override: p2Override,
      }),
    [
      year,
      salaryBefore,
      salaryAfter,
      incrementMonth,
      row.monthlyPresence,
      valid,
      p1Override,
      p2Override,
    ],
  );
  const fig = locked ? effectiveFigures(row.working, row.live) : effectiveFigures(null, live);

  const dirty =
    !locked &&
    (salaryBefore !== row.salaryBefore ||
      salaryAfter !== row.salaryAfter ||
      incrementMonth !== row.incrementMonth ||
      remarks.trim() !== row.remarks.trim() ||
      p1Override !== row.calendarDaysP1Override ||
      p2Override !== row.calendarDaysP2Override ||
      row.working === null);

  return (
    <>
      <tr className="leave-salary-working-row" onClick={() => setOpen((o) => !o)}>
        <td>
          <b>{row.name}</b>{' '}
          <span className="text-monospace text-muted leave-salary-detail">
            {row.code}
          </span>
          {!row.onRoster && (
            <div className="text-muted leave-salary-detail">
              no longer on the roster
            </div>
          )}
          {row.drift && (
            <div className="leave-salary-drift">
              attendance changed since {status} — reopen to recompute
            </div>
          )}
        </td>
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <span className="text-monospace">{inr(row.salaryBefore)}</span>
          ) : (
            <input
              className="text-monospace leave-salary-input"
              value={salaryBeforeInput}
              onChange={(e) => setSalaryBeforeInput(e.target.value)}
              aria-label={`${row.name}: monthly salary before the increment`}
            />
          )}
        </td>
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <span className="text-monospace">{inr(row.salaryAfter)}</span>
          ) : (
            <input
              className="text-monospace leave-salary-input"
              value={salaryAfterInput}
              onChange={(e) => setSalaryAfterInput(e.target.value)}
              aria-label={`${row.name}: monthly salary after the increment`}
            />
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {locked ? (
            monthNames[incrementMonth - 1]
          ) : (
            <select
              value={incrementMonth}
              onChange={(e) => setIncrementMonth(Number(e.target.value))}
              aria-label={`${row.name}: month the increment takes effect`}
            >
              {monthNames.map((m, ix) => (
                <option key={m} value={ix + 1}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="text-right text-monospace" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <>
              {fig.presentP1}
              <span className="text-muted">/{fig.calendarDaysP1}</span>
            </>
          ) : (
            <span className="leave-salary-day-value">
              {fig.presentP1}
              <span className="text-muted">/</span>
              <input
                className="text-monospace leave-salary-days-input"
                value={daysBeforeIncrementInput}
                onChange={(e) => setDaysBeforeIncrementInput(e.target.value)}
                placeholder={String(live.p1.calendarDays)}
                data-tooltip-content="Days in the pre-increment period (the ÷ days of the formula) — blank uses the real calendar days"
                aria-label={`${row.name}: calendar days before the increment (blank = real calendar days)`}
              />
            </span>
          )}
        </td>
        <td className="text-right text-monospace" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <>
              {fig.presentP2}
              <span className="text-muted">/{fig.calendarDaysP2}</span>
            </>
          ) : (
            <span className="leave-salary-day-value">
              {fig.presentP2}
              <span className="text-muted">/</span>
              <input
                className="text-monospace leave-salary-days-input"
                value={daysAfterIncrementInput}
                onChange={(e) => setDaysAfterIncrementInput(e.target.value)}
                placeholder={String(live.p2.calendarDays)}
                data-tooltip-content="Days in the post-increment period (the ÷ days of the formula) — blank uses the real calendar days"
                aria-label={`${row.name}: calendar days after the increment (blank = real calendar days)`}
              />
            </span>
          )}
        </td>
        <td className="text-right text-monospace">{inr(fig.amountP1)}</td>
        <td className="text-right text-monospace">{inr(fig.amountP2)}</td>
        <td className="text-right text-monospace leave-salary-amount">
          {inr(fig.total)}
        </td>
        <td>
          <span
            className="status-badge leave-salary-status"
            style={{ color: statusColor[status ?? 'draft'] }}
          >
            {status ?? 'unsaved'}
          </span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className="leave-salary-row-actions">
            {!locked && (
              <button
                className="button quiet"
                disabled={pending || !migrated || !valid || !dirty}
                data-tooltip-content={
                  !migrated
                    ? 'Ask an administrator to configure leave salary storage first'
                    : !valid
                      ? 'Enter both salaries'
                      : !dirty
                        ? 'Nothing changed'
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
                        incrementMonth,
                        remarks,
                        calendarDaysP1Override: p1Override,
                        calendarDaysP2Override: p2Override,
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
                className="button quiet"
                disabled={pending}
                onClick={() =>
                  onAction(() => finalizeLeaveSalary(row.working!.id), 'Working finalized.')
                }
              >
                Finalize
              </button>
            )}
            {status === 'finalized' && (
              <>
                <button
                  className="button quiet"
                  disabled={pending}
                  onClick={() =>
                    onAction(
                      () => reopenLeaveSalary(row.working!.id),
                      'Working reopened for editing.',
                    )
                  }
                >
                  Reopen
                </button>
                <button
                  className="button quiet"
                  disabled={pending}
                  onClick={async () => {
                    if (!(await onConfirmPaid(row.name, fig.total))) {
                      return;
                    }
                    onAction(
                      () => markLeaveSalaryPaid(row.working!.id),
                      'Leave salary marked paid.',
                    );
                  }}
                >
                  Mark paid
                </button>
              </>
            )}
            {status === 'paid' && <span className="text-muted">settled</span>}
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={11} className="leave-salary-breakdown-cell">
            <Breakdown
              year={year}
              salaryBefore={locked ? row.salaryBefore : salaryBefore}
              salaryAfter={locked ? row.salaryAfter : salaryAfter}
              incMonth={incrementMonth}
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
  incMonth: incrementMonth,
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
  const monthsP1 = incrementMonth - 1;
  const monthsP2 = 12 - monthsP1;
  const entitled = (salary: number, months: number) =>
    Math.round((salary / 2) * (months / 12) * 100) / 100;

  const line = (label: string, value: string) => (
    <div className="leave-salary-breakdown-line">
      <span className="text-muted">{label}</span>
      <span className="text-monospace">{value}</span>
    </div>
  );

  const p1Range = monthsP1 > 0 ? `Jan – ${monthNames[monthsP1 - 1].slice(0, 3)}` : '—';
  const p2Range = `${monthNames[incrementMonth - 1].slice(0, 3)} – Dec`;

  return (
    <div
      className="leave-salary-breakdown"
    >
      <div>
        <div className="leave-salary-breakdown-title">
          Before increment · {p1Range} {year}
        </div>
        {line('Monthly salary', inr(salaryBefore))}
        {line('Leave salary (½ month)', inr(salaryBefore / 2))}
        {line(
          `Entitled for ${monthsP1} month${monthsP1 === 1 ? '' : 's'}`,
          inr(entitled(salaryBefore, monthsP1)),
        )}
        {line('Days present / calendar', `${fig.presentP1} / ${fig.calendarDaysP1}`)}
        {line('Payable', inr(fig.amountP1))}
      </div>
      <div>
        <div className="leave-salary-breakdown-title">
          After increment · {p2Range} {year}
        </div>
        {line('Monthly salary', inr(salaryAfter))}
        {line('Leave salary (½ month)', inr(salaryAfter / 2))}
        {line(
          `Entitled for ${monthsP2} month${monthsP2 === 1 ? '' : 's'}`,
          inr(entitled(salaryAfter, monthsP2)),
        )}
        {line('Days present / calendar', `${fig.presentP2} / ${fig.calendarDaysP2}`)}
        {line('Payable', inr(fig.amountP2))}
      </div>
      <div>
        <div className="leave-salary-breakdown-title">Total · {inr(fig.total)}</div>
        {locked ? (
          remarks ? (
            <p className="leave-salary-message">{remarks}</p>
          ) : (
            <p className="text-muted leave-salary-message">
              No remarks.
            </p>
          )
        ) : (
          <textarea
            value={remarks}
            onChange={(e) => onRemarks(e.target.value)}
            placeholder="Remarks (saved with the working)"
            rows={3}
            className="leave-salary-remarks"
            aria-label="Remarks for this working"
          />
        )}
      </div>
    </div>
  );
}

// pool card

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
    <div className="leave-salary-balance-form">
      <input
        className="text-monospace leave-salary-balance-days"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        placeholder="±days"
        aria-label="Days to credit or debit"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        className="leave-salary-balance-reason"
        aria-label="Reason for the adjustment"
      />
      <button
        className="button quiet"
        disabled={disabled || busy || !ready}
        data-tooltip-content={!ready ? 'Enter a non-zero day count and a reason' : undefined}
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

export { LeaveSalaryAdmin };
