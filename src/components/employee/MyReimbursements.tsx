'use client';

// Employee expense claims. Travel previews use distance × rate; the server recalculates the amount
// on submission and approval.
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr, formatDate, todayIST } from '@/lib/display-formatting';
import { createReimbursement, updateReimbursement, deleteReimbursement, uploadReimbursementReceipt, getReceiptUrl } from '@/lib/actions/reimbursements';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import type { NotificationKind } from '@/components/ui/Notifications';
import type { ReimbursementView } from '@/lib/queries/reimbursements';
import type { ReimbursementPurpose } from '@/types/database';

const purposeLabel: Record<ReimbursementPurpose, string> = {
  travel: 'Travel',
  material_purchase: 'Material purchase',
  other: 'Other expenses',
};

const purposeOptions: ReimbursementPurpose[] = ['travel', 'material_purchase', 'other'];

const statusLabel: Record<ReimbursementView['status'], string> = {
  pending: 'Pending',
  finance_review: 'With Finance',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};

function statusPillStyle(status: ReimbursementView['status']): React.CSSProperties {
  if (status === 'pending' || status === 'finance_review') {
    return {
      borderColor: 'var(--attendance-late-border)',
      color: 'var(--attendance-late)',
      background: 'var(--attendance-late-background)',
    };
  }
  if (status === 'approved') {
    return {
      borderColor: 'var(--attendance-present-border)',
      color: 'var(--attendance-present)',
      background: 'var(--attendance-present-background)',
    };
  }
  if (status === 'rejected') {
    return { borderColor: 'var(--border-strong)', color: 'var(--attendance-half-day)' };
  }
  return { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' };
}

function MyReimbursements({
  claims,
  ratePerKm,
  canClaim,
  blockedReason,
  id,
}: {
  claims: ReimbursementView[];
  ratePerKm: number;
  canClaim: boolean;
  blockedReason: string;
  id?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ReimbursementView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

  // Receipts live in a private bucket — open via a short-lived signed URL.
  async function openReceipt(id: string) {
    const res = await getReceiptUrl(id);
    if (!res.ok || !res.url) {
      showNotification(res.error ?? 'Could not open the receipt.', 'error');
      return;
    }
    window.open(res.url, '_blank', 'noopener,noreferrer');
  }

  async function withdraw(c: ReimbursementView) {
    const ok = await confirm({
      title: 'Withdraw claim',
      message: 'Withdraw this claim? This cannot be undone.',
      confirmLabel: 'Withdraw',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setBusy(c.id);
    startTransition(async () => {
      const res = await deleteReimbursement(c.id);
      setBusy(null);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not withdraw the claim.', 'error');
      } else {
        showNotification('Claim withdrawn.', 'success');
        if (editing?.id === c.id) {
          setEditing(null);
        }
        router.refresh();
      }
    });
  }

  return (
    <div className="two-column-layout" id={id}>
      {confirmDialog}
      {notificationContainer}
      <div className="card">
        <div className="card-header">
          <h3>My reimbursement claims</h3>
          <span className="card-caption">{claims.length} total</span>
        </div>
        <div className="card-body">
          {claims.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>
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
                    <th className="text-right">Kms</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c, ix) => (
                    <tr key={c.id}>
                      <td className="text-monospace text-muted">{ix + 1}</td>
                      <td>
                        {c.description}
                        {c.remarks && (
                          <div className="text-muted" style={{ fontSize: 11 }}>
                            {c.remarks}
                          </div>
                        )}
                        {c.status === 'rejected' && c.reviewRemark && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--attendance-half-day)',
                              marginTop: 2,
                            }}
                          >
                            <b>Rejected:</b> {c.reviewRemark}
                          </div>
                        )}
                      </td>
                      <td>{purposeLabel[c.purpose]}</td>
                      <td className="text-monospace">{formatDate(c.claimDate)}</td>
                      <td className="text-right text-monospace">{c.kms ?? '—'}</td>
                      <td className="text-right text-monospace" style={{ fontWeight: 700 }}>
                        {inr(c.amount)}
                      </td>
                      <td>
                        <span className="status-badge" style={statusPillStyle(c.status)}>
                          {statusLabel[c.status]}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {c.status === 'pending' && (
                            <>
                              <button
                                className="button quiet"
                                disabled={pending && busy === c.id}
                                onClick={() => setEditing(c)}
                              >
                                Edit
                              </button>
                              <button
                                className="button quiet"
                                disabled={pending && busy === c.id}
                                onClick={() => withdraw(c)}
                                style={{ color: 'var(--attendance-absent)' }}
                              >
                                {pending && busy === c.id ? '…' : 'Withdraw'}
                              </button>
                            </>
                          )}
                          {/* Editing a rejected claim returns it to the review queue. */}
                          {c.status === 'rejected' && (
                            <button
                              className="button quiet"
                              disabled={pending && busy === c.id}
                              onClick={() => setEditing(c)}
                              title="Correct this claim and submit it again"
                            >
                              Fix &amp; resubmit
                            </button>
                          )}
                          {c.receiptPath && (
                            <button className="button quiet" onClick={() => openReceipt(c.id)}>
                              📎 Receipt
                            </button>
                          )}
                          {c.status !== 'pending' && c.status !== 'rejected' && !c.receiptPath && (
                            <span className="text-muted">—</span>
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
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{editing ? 'Edit claim' : 'File a claim'}</h3>
          <span className="card-caption">Travel · ₹{ratePerKm}/km</span>
        </div>
        <div className="card-body">
          {canClaim ? (
            <ClaimForm
              key={editing?.id ?? 'new'}
              ratePerKm={ratePerKm}
              claim={editing}
              onDone={() => setEditing(null)}
              showNotification={showNotification}
            />
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
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
  showNotification,
}: {
  ratePerKm: number;
  // When set, the form edits this pending claim instead of creating a new one.
  claim: ReimbursementView | null;
  onDone: () => void;
  showNotification: (message: string, kind?: NotificationKind) => void;
}) {
  const router = useRouter();
  const editing = claim !== null;
  const [purpose, setPurpose] = useState<ReimbursementPurpose>(claim?.purpose ?? 'travel');
  const [kms, setKms] = useState(claim?.kms != null ? String(claim.kms) : '');
  const [amount, setAmount] = useState(
    claim && claim.purpose !== 'travel' ? String(claim.amount) : '',
  );

  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = editing
        ? await updateReimbursement(claim!.id, formData)
        : await createReimbursement(formData);
      if (res.ok) {
        showNotification(editing ? 'Claim updated.' : 'Claim submitted for approval.', 'success');
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
      <div className="form-field">
        <label>Description</label>
        <input
          name="description"
          placeholder="e.g. Client visit — Nashik plant"
          defaultValue={claim?.description}
          required
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Purpose</label>
          <select
            name="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as ReimbursementPurpose)}
          >
            {purposeOptions.map((p) => (
              <option key={p} value={p}>
                {purposeLabel[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Date</label>
          <input
            name="claim_date"
            type="date"
            max={todayIST()}
            defaultValue={claim?.claimDate}
            required
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Source / Medium</label>
          <input
            name="source_medium"
            placeholder="e.g. Own car, Ola, Vendor"
            defaultValue={claim?.sourceMedium ?? ''}
          />
        </div>
        <div className="form-field">
          <label>Mode of payment</label>
          <input
            name="mode_of_payment"
            placeholder="e.g. Cash, UPI, Card"
            defaultValue={claim?.modeOfPayment ?? ''}
          />
        </div>
      </div>

      {isTravel ? (
        <div className="form-row">
          <div className="form-field">
            <label>Kms travelled</label>
            <input
              name="kms"
              className="text-monospace"
              inputMode="decimal"
              value={kms}
              onChange={(e) => setKms(e.target.value)}
              placeholder="e.g. 42"
              required
            />
          </div>
          <div className="form-field">
            <label>Amount (₹{ratePerKm}/km)</label>
            <input
              className="text-monospace"
              value={derived ? derived.toFixed(2) : ''}
              readOnly
              placeholder="—"
            />
          </div>
        </div>
      ) : (
        <div className="form-field">
          <label>Amount (₹)</label>
          <input
            name="amount"
            className="text-monospace"
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

      <div className="form-field">
        <label>Remarks</label>
        <textarea
          name="remarks"
          rows={3}
          placeholder="Anything the approver should know…"
          defaultValue={claim?.remarks ?? ''}
          style={{
            width: '100%',
            padding: '9px 11px',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            font: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Receipt upload is only offered when EDITING an existing claim: the file needs a claim id to attach to, so a new claim is saved first, then the receipt added from the row. */}
      {editing && (
        <div className="form-field">
          <label>Receipt</label>
          <ReceiptUpload
            claimId={claim!.id}
            hasReceipt={claim!.receiptPath != null}
            showNotification={showNotification}
          />
        </div>
      )}

      {state.error && <div className="error-message">{state.error}</div>}
      {state.ok && !editing && <div className="hint">✓&nbsp; Claim submitted for approval.</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Submit claim'}
        </button>
        {editing && (
          <button type="button" className="button quiet" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// Attach (or replace) a receipt on an existing claim. Uploads straight to the private
// reimbursement-receipts bucket via the server action, which puts it in the employee's own folder,
// which is what limits it to them + staff.
function ReceiptUpload({
  claimId,
  hasReceipt,
  showNotification,
}: {
  claimId: string;
  hasReceipt: boolean;
  showNotification: (message: string, kind?: NotificationKind) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) {
            return;
          }
          setBusy(true);
          const fd = new FormData();
          fd.set('receipt', file);
          const res = await uploadReimbursementReceipt(claimId, fd);
          setBusy(false);
          e.target.value = '';
          if (!res.ok) {
            showNotification(res.error ?? 'The receipt could not be attached.', 'error');
          } else {
            showNotification('Receipt attached.', 'success');
            router.refresh();
          }
        }}
      />
      <span className="hint">
        {busy
          ? 'Uploading…'
          : hasReceipt
            ? 'A receipt is attached — choosing a file replaces it.'
            : 'JPG/PNG/PDF, up to 5 MB.'}
      </span>
    </>
  );
}

export { MyReimbursements };
