'use client';

// Employee expense claims: file a new claim, edit or withdraw a still-pending
// one, and track your own.
// For a TRAVEL claim the amount is derived live as km × rate. That preview is a
// convenience only — the server recomputes it on create AND at approval, so the
// approved amount is never whatever the browser posted.
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr, formatDate } from '@/lib/format';
import {
  createReimbursement,
  updateReimbursement,
  deleteReimbursement,
} from '@/lib/actions/reimbursements';
import type { ReimbursementView } from '@/lib/queries';
import type { ReimbursementPurpose } from '@/types/database';

const PURPOSE_LABEL: Record<ReimbursementPurpose, string> = {
  travel: 'Travel',
  material_purchase: 'Material purchase',
  other: 'Other expenses',
};

const PURPOSE_OPTIONS: ReimbursementPurpose[] = ['travel', 'material_purchase', 'other'];

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

export function MyReimbursements({
  claims,
  ratePerKm,
  canClaim,
  blockedReason,
}: {
  claims: ReimbursementView[];
  ratePerKm: number;
  canClaim: boolean;
  blockedReason: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ReimbursementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function withdraw(c: ReimbursementView) {
    if (!window.confirm('Withdraw this claim? This cannot be undone.')) return;
    setError(null);
    setBusy(c.id);
    startTransition(async () => {
      const res = await deleteReimbursement(c.id);
      setBusy(null);
      if (!res.ok) setError(res.error ?? 'Could not withdraw the claim.');
      else {
        if (editing?.id === c.id) setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="two-col">
      <div className="card">
        <div className="hd">
          <h3>My reimbursement claims</h3>
          <span className="folio">{claims.length} total</span>
        </div>
        <div className="bd">
          {error && <div className="login-error">{error}</div>}
          {claims.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {canClaim ? 'No claims yet — file one on the right.' : 'No claims to show.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Sr.</th>
                    <th>Description</th>
                    <th>Purpose</th>
                    <th>Date</th>
                    <th className="right">Kms</th>
                    <th className="right">Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c, ix) => (
                    <tr key={c.id}>
                      <td className="mono muted">{ix + 1}</td>
                      <td>
                        {c.description}
                        {c.remarks && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {c.remarks}
                          </div>
                        )}
                        {c.status === 'rejected' && c.reviewRemark && (
                          <div style={{ fontSize: 11, color: 'var(--hd)', marginTop: 2 }}>
                            <b>Rejected:</b> {c.reviewRemark}
                          </div>
                        )}
                      </td>
                      <td>{PURPOSE_LABEL[c.purpose]}</td>
                      <td className="mono">{formatDate(c.claimDate)}</td>
                      <td className="right mono">{c.kms ?? '—'}</td>
                      <td className="right mono" style={{ fontWeight: 700 }}>
                        {inr(c.amount)}
                      </td>
                      <td>
                        <span className="pill" style={statusPillStyle(c.status)}>
                          {STATUS_LABEL[c.status]}
                        </span>
                      </td>
                      <td>
                        {c.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn quiet"
                              disabled={pending && busy === c.id}
                              onClick={() => setEditing(c)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn quiet"
                              disabled={pending && busy === c.id}
                              onClick={() => withdraw(c)}
                              style={{ color: 'var(--ab)' }}
                            >
                              {pending && busy === c.id ? '…' : 'Withdraw'}
                            </button>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
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
          <h3>{editing ? 'Edit claim' : 'File a claim'}</h3>
          <span className="folio">Travel · ₹{ratePerKm}/km</span>
        </div>
        <div className="bd">
          {canClaim ? (
            <ClaimForm
              key={editing?.id ?? 'new'}
              ratePerKm={ratePerKm}
              claim={editing}
              onDone={() => setEditing(null)}
            />
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              {blockedReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ClaimForm({
  ratePerKm,
  claim,
  onDone,
}: {
  ratePerKm: number;
  /** When set, the form edits this pending claim instead of creating a new one. */
  claim: ReimbursementView | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = claim !== null;
  const [purpose, setPurpose] = useState<ReimbursementPurpose>(claim?.purpose ?? 'travel');
  const [kms, setKms] = useState(claim?.kms != null ? String(claim.kms) : '');
  const [amount, setAmount] = useState(claim && claim.purpose !== 'travel' ? String(claim.amount) : '');

  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = editing
        ? await updateReimbursement(claim!.id, formData)
        : await createReimbursement(formData);
      if (res.ok) {
        if (!editing) {
          setKms('');
          setAmount('');
        }
        onDone();
        router.refresh();
      }
      return res;
    },
    {},
  );

  const isTravel = purpose === 'travel';
  const kmsNum = Number(kms.replace(/[^0-9.]/g, ''));
  const derived = isTravel && Number.isFinite(kmsNum) && kmsNum > 0 ? kmsNum * ratePerKm : 0;

  return (
    <form action={action}>
      <div className="f">
        <label>Description</label>
        <input
          name="description"
          placeholder="e.g. Client visit — Nashik plant"
          defaultValue={claim?.description}
          required
        />
      </div>

      <div className="f-row">
        <div className="f">
          <label>Purpose</label>
          <select
            name="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as ReimbursementPurpose)}
          >
            {PURPOSE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="f">
          <label>Date</label>
          <input name="claim_date" type="date" defaultValue={claim?.claimDate} required />
        </div>
      </div>

      <div className="f-row">
        <div className="f">
          <label>Source / Medium</label>
          <input name="source_medium" placeholder="e.g. Own car, Ola, Vendor" defaultValue={claim?.sourceMedium ?? ''} />
        </div>
        <div className="f">
          <label>Mode of payment</label>
          <input name="mode_of_payment" placeholder="e.g. Cash, UPI, Card" defaultValue={claim?.modeOfPayment ?? ''} />
        </div>
      </div>

      {isTravel ? (
        <div className="f-row">
          <div className="f">
            <label>Kms travelled</label>
            <input
              name="kms"
              className="mono"
              inputMode="decimal"
              value={kms}
              onChange={(e) => setKms(e.target.value)}
              placeholder="e.g. 42"
              required
            />
          </div>
          <div className="f">
            <label>Amount (₹{ratePerKm}/km)</label>
            <input className="mono" value={derived ? derived.toFixed(2) : ''} readOnly placeholder="—" />
          </div>
        </div>
      ) : (
        <div className="f">
          <label>Amount (₹)</label>
          <input
            name="amount"
            className="mono"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 1250"
            required
          />
        </div>
      )}

      {isTravel && derived > 0 && (
        <div className="hint">
          {kmsNum} km × ₹{ratePerKm} = <b>{inr(derived)}</b>
        </div>
      )}

      <div className="f">
        <label>Remarks</label>
        <textarea
          name="remarks"
          rows={3}
          placeholder="Anything the approver should know…"
          defaultValue={claim?.remarks ?? ''}
          style={{
            width: '100%',
            padding: '9px 11px',
            border: '1px solid var(--line-2)',
            borderRadius: 8,
            font: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
      </div>

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && !editing && <div className="hint">✓&nbsp; Claim submitted for approval.</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Submit claim'}
        </button>
        {editing && (
          <button type="button" className="btn quiet" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
