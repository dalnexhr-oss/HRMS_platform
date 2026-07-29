'use client';

// HR leave administration: open a leave year, correct a balance with a reason,
// and run encashment. This is the screen that makes leave_balances real — before
// it, no row was ever created, so approvals deducted nothing and the pills on an
// employee's dashboard were decoration.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@/lib/format';
import {
  provisionLeaveYear,
  adjustLeaveBalance,
  createLeaveEncashment,
  approveLeaveEncashment,
  markEncashmentPaid,
} from '@/lib/actions/leave';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type {
  LeaveBalanceAdminRow,
  LeaveEncashmentRow,
  LeaveAdjustmentRow,
  EmployeeOption,
} from '@/lib/queries';

const LEAVE_TYPES = ['PL', 'CL', 'SL'] as const;

export function LeaveAdmin({
  year,
  balances,
  encashments,
  adjustments,
  employees,
}: {
  year: number;
  balances: LeaveBalanceAdminRow[];
  encashments: LeaveEncashmentRow[];
  adjustments: LeaveAdjustmentRow[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  // Pivot the flat rows into one row per employee with a column per type.
  const byEmployee = new Map<string, { code: string; name: string; types: Record<string, number> }>();
  for (const b of balances) {
    const row = byEmployee.get(b.employeeId) ?? { code: b.code, name: b.name, types: {} };
    row.types[b.type] = b.balance;
    byEmployee.set(b.employeeId, row);
  }
  const rows = [...byEmployee.entries()].map(([id, r]) => ({ id, ...r }));

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
        `Credit every employee still on the roster their annual entitlement for ${year}, carrying ` +
        `last year's remainder forward up to the configured cap?\n\n` +
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
            : `Provisioned ${res.created} balance row(s) for ${year}.`,
          'success',
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="wrap grid">
      {confirmDialog}
      {toastNode}

      <div className="card">
        <div className="hd">
          <h3>Leave balances · {year}</h3>
          <span className="folio">{rows.length} employee{rows.length === 1 ? '' : 's'}</span>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={onProvision} disabled={pending}>
            {pending ? 'Working…' : `Open leave year ${year}`}
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>
              No balances for {year} yet. Use <b>Open leave year</b> to credit everyone their
              entitlement — until then, approving leave deducts nothing.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  {LEAVE_TYPES.map((t) => (
                    <th key={t} className="right">{t}</th>
                  ))}
                  <th>Adjust</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>{' '}
                      <span className="mono muted" style={{ fontSize: 11 }}>{r.code}</span>
                    </td>
                    {LEAVE_TYPES.map((t) => (
                      <td key={t} className="right mono">
                        {r.types[t] ?? <span className="muted">—</span>}
                      </td>
                    ))}
                    <td>
                      <AdjustForm
                        employeeId={r.id}
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

      <div className="two-col">
        <div className="card">
          <div className="hd">
            <h3>Leave encashment</h3>
            <span className="folio">{encashments.length} request{encashments.length === 1 ? '' : 's'}</span>
          </div>
          <div className="bd">
            <EncashmentForm
              employees={employees}
              year={year}
              disabled={pending}
              onDone={(res) => {
                if (!res.ok) toast(res.error ?? 'Could not file the request.', 'error');
                else {
                  toast('Encashment request filed.', 'success');
                  router.refresh();
                }
              }}
            />
            {encashments.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>No encashment requests yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="right">Days</th>
                      <th className="right">Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {encashments.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.name}{' '}
                          <span className="mono muted" style={{ fontSize: 11 }}>{e.code}</span>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {e.type} · {e.year}
                          </div>
                        </td>
                        <td className="right mono">{e.days}</td>
                        <td className="right mono">{e.amount ? inr(e.amount) : '—'}</td>
                        <td>
                          <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
                            {e.status}
                          </span>
                        </td>
                        <td>
                          {e.status === 'requested' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() =>
                                run(() => approveLeaveEncashment(e.id), 'Encashment approved and balance debited.')
                              }
                            >
                              Approve
                            </button>
                          )}
                          {e.status === 'approved' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() => run(() => markEncashmentPaid(e.id), 'Encashment marked paid.')}
                            >
                              Mark paid
                            </button>
                          )}
                          {e.status === 'paid' && <span className="muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="hd">
            <h3>Recent adjustments</h3>
            <span className="folio">{adjustments.length}</span>
          </div>
          <div className="bd">
            {adjustments.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                No manual adjustments recorded.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="right">Δ</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.name}{' '}
                          <span className="mono muted" style={{ fontSize: 11 }}>{a.code}</span>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {a.type} · {a.year}
                          </div>
                        </td>
                        <td
                          className="right mono"
                          style={{ color: a.delta > 0 ? 'var(--p)' : 'var(--ab)', fontWeight: 700 }}
                        >
                          {a.delta > 0 ? '+' : ''}
                          {a.delta}
                        </td>
                        <td style={{ fontSize: 12 }}>{a.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline per-employee credit/debit. A reason is mandatory — the audit row requires it. */
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
  const [type, setType] = useState<string>('PL');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = delta.trim() !== '' && Number(delta) !== 0 && reason.trim() !== '';

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: '4px 6px' }}>
        {LEAVE_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
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
            type,
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

/** File an encashment request against an employee's balance. */
function EncashmentForm({
  employees,
  year,
  disabled,
  onDone,
}: {
  employees: EmployeeOption[];
  year: number;
  disabled: boolean;
  onDone: (res: { ok: boolean; error?: string }) => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('PL');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = employeeId !== '' && days.trim() !== '' && Number(days) > 0;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={{ flex: '1 1 160px' }}>
        <option value="">Choose an employee…</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.code} — {e.name}
          </option>
        ))}
      </select>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {LEAVE_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <input
        className="mono"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        placeholder="days"
        style={{ width: 70 }}
        aria-label="Days to encash"
      />
      <button
        className="btn primary"
        disabled={disabled || busy || !ready}
        onClick={async () => {
          setBusy(true);
          const res = await createLeaveEncashment({ employeeId, year, type, days: Number(days) });
          setBusy(false);
          if (res.ok) setDays('');
          onDone(res);
        }}
      >
        {busy ? '…' : 'File encashment'}
      </button>
    </div>
  );
}
