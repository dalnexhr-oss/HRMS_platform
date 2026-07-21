'use client';

// Staff review queue for expense claims: approve / reject / mark paid.
// Columns mirror the company's claim sheet — Sr.No, Description, Purpose, Date,
// Source/Medium, Kms, Mode of payment, Amount, Remarks.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr, formatDate } from '@/lib/format';
import { reviewReimbursement, markReimbursementPaid } from '@/lib/actions/reimbursements';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { exportReimbursementsXlsx } from '@/lib/actions/export';
import type { ReimbursementView } from '@/lib/queries';

const PURPOSE_LABEL: Record<ReimbursementView['purpose'], string> = {
  travel: 'Travel',
  material_purchase: 'Material purchase',
  other: 'Other expenses',
};

const STATUS_LABEL: Record<ReimbursementView['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};

function statusPillStyle(status: ReimbursementView['status']): React.CSSProperties {
  if (status === 'pending') return { borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' };
  if (status === 'approved') return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
  if (status === 'rejected') return { borderColor: 'var(--line-2)', color: 'var(--hd)' };
  return { borderColor: 'var(--line-2)', color: 'var(--ink-3)' };
}

type Filter = 'pending' | 'all';

export function ReimbursementsScreen({ claims }: { claims: ReimbursementView[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(
    () => (filter === 'pending' ? claims.filter((c) => c.status === 'pending') : claims),
    [claims, filter],
  );

  const pendingTotal = claims
    .filter((c) => c.status === 'pending')
    .reduce((a, c) => a + c.amount, 0);
  const approvedTotal = claims
    .filter((c) => c.status === 'approved')
    .reduce((a, c) => a + c.amount, 0);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) setError(res.error ?? 'The action failed.');
      else router.refresh();
    });
  }

  return (
    <div className="wrap grid">
      <div className="kpis">
        <div className="card kpi">
          <div className="lab">Pending claims</div>
          <div className="val" style={{ color: 'var(--lm)' }}>
            {claims.filter((c) => c.status === 'pending').length}
          </div>
          <div className="note">{inr(pendingTotal)} awaiting review</div>
        </div>
        <div className="card kpi">
          <div className="lab">Approved (unpaid)</div>
          <div className="val" style={{ color: 'var(--p)' }}>
            {claims.filter((c) => c.status === 'approved').length}
          </div>
          <div className="note">{inr(approvedTotal)} added to payroll</div>
        </div>
        <div className="card kpi">
          <div className="lab">Total claims</div>
          <div className="val">{claims.length}</div>
          <div className="note">All time</div>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="card">
        <div className="hd">
          <h3>Expense claims</h3>
          <span className="folio">{rows.length} shown</span>
          <span style={{ flex: 1 }} />
          <button
            className={`btn${filter === 'pending' ? ' primary' : ' quiet'}`}
            onClick={() => setFilter('pending')}
          >
            Pending
          </button>
          <button
            className={`btn${filter === 'all' ? ' primary' : ' quiet'}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <XlsxExportButton action={exportReimbursementsXlsx} label="Export .xlsx" />
        </div>

        {rows.length === 0 ? (
          <div className="bd">
            <div className="empty">
              <p>{filter === 'pending' ? 'No claims waiting for review.' : 'No claims yet.'}</p>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Sr.</th>
                  <th>Employee</th>
                  <th>Description</th>
                  <th>Purpose</th>
                  <th>Date</th>
                  <th>Source / Medium</th>
                  <th className="right">Kms</th>
                  <th>Mode of payment</th>
                  <th className="right">Amount</th>
                  <th>Remarks</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, ix) => (
                  <tr key={c.id}>
                    {/* Sr. No is positional, never stored — deleting a claim
                        can't leave a gap in the sequence. */}
                    <td className="mono muted">{ix + 1}</td>
                    <td>
                      <b>{c.employeeName}</b>
                      <br />
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {c.employeeCode}
                      </span>
                    </td>
                    <td>{c.description}</td>
                    <td>{PURPOSE_LABEL[c.purpose]}</td>
                    <td className="mono">{formatDate(c.claimDate)}</td>
                    <td>{c.sourceMedium ?? <span className="muted">—</span>}</td>
                    <td className="right mono">{c.kms ?? '—'}</td>
                    <td>{c.modeOfPayment ?? <span className="muted">—</span>}</td>
                    <td className="right mono" style={{ fontWeight: 700 }}>
                      {inr(c.amount)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {c.remarks ?? '—'}
                    </td>
                    <td>
                      <span className="pill" style={statusPillStyle(c.status)}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {c.status === 'pending' && (
                          <>
                            <button
                              className="btn primary"
                              disabled={pending && busy === c.id}
                              onClick={() => run(c.id, () => reviewReimbursement(c.id, 'approved'))}
                            >
                              {pending && busy === c.id ? '…' : 'Approve'}
                            </button>
                            <button
                              className="btn"
                              disabled={pending && busy === c.id}
                              onClick={() => run(c.id, () => reviewReimbursement(c.id, 'rejected'))}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {c.status === 'approved' && (
                          <button
                            className="btn quiet"
                            disabled={pending && busy === c.id}
                            onClick={() => run(c.id, () => markReimbursementPaid(c.id))}
                          >
                            Mark paid
                          </button>
                        )}
                        {(c.status === 'rejected' || c.status === 'paid') && (
                          <span className="muted" style={{ fontSize: 12 }}>
                            —
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Approving a claim adds its amount to that employee’s “Reimbursement / bonus” adjustment on
        the payslip for the claim’s month and recomputes it, so it is paid with salary. Travel claims
        are calculated as km × the rate in Settings.
      </p>
    </div>
  );
}
