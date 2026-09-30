'use client';

// Apply for a day off using a comp-off credit. HR approval stamps the day CO and marks the credit
// used.
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate, todayIST } from '@/lib/format';
import { applyCompOff } from '@/lib/actions/comp-off';
import { RequestRecipients } from '@/components/requests/RequestRecipients';
import type { CompOffRow } from '@/lib/queries';
import type { RequestRecipient } from '@/types/requests';

const statusLabel: Record<CompOffRow['status'], string> = {
  available: 'Available',
  applied: 'Applied — awaiting approval',
  used: 'Used',
  expired: 'Expired',
};

function pillStyle(c: CompOffRow): React.CSSProperties {
  // A credit staff put on hold renders muted even though its status is
  // 'available' — the employee cannot use it until HR switches it back.
  if (c.status === 'available' && !c.isApplicable) {
    return { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' };
  }
  if (c.status === 'available') {
    return { borderColor: 'var(--attendance-present-border)', color: 'var(--attendance-present)', background: 'var(--attendance-present-background)' };
  }
  if (c.status === 'applied') {
    return { borderColor: 'var(--attendance-late-border)', color: 'var(--attendance-late)', background: 'var(--attendance-late-background)' };
  }
  return { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' };
}

function pillLabel(c: CompOffRow): string {
  if (c.status === 'available' && !c.isApplicable) {
    return 'Not applicable (on hold by HR)';
  }
  return statusLabel[c.status];
}

function MyCompOffs({
  compOffs,
  canApply,
  blockedReason,
  people,
  id,
}: {
  compOffs: CompOffRow[];
  canApply: boolean;
  blockedReason: string;
  people: RequestRecipient[];
  id?: string;
}) {
  // The balance: available AND applicable. Credits HR put on hold don't count.
  const usable = compOffs.filter((c) => c.status === 'available' && c.isApplicable);

  return (
    <div className="card" id={id}>
      <div className="card-header">
        <h3>Comp offs</h3>
        <span className="card-caption">
          Balance: {usable.length} · {compOffs.length} earned in total
        </span>
      </div>
      <div className="card-body">
        {compOffs.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No comp offs yet. When you work on a week-off or holiday, HR can grant you a comp-off
            credit from the register — it will appear here to use.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {compOffs.map((c) => (
                <span key={c.id} className="status-badge" style={pillStyle(c)}>
                  Earned {formatDate(c.earnedDate)} · {pillLabel(c)}
                  {c.usedDate && c.status === 'used' ? ` (taken ${formatDate(c.usedDate)})` : ''}
                </span>
              ))}
            </div>

            {usable.length > 0 &&
              (canApply ? (
                <ApplyForm available={usable} people={people} />
              ) : (
                <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                  {blockedReason}
                </p>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function ApplyForm({ available, people }: { available: CompOffRow[]; people: RequestRecipient[] }) {
  const router = useRouter();
  const [recipientKey, setRecipientKey] = useState(0);
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await applyCompOff(formData);
      if (res.ok) {
        setRecipientKey((value) => value + 1);
        router.refresh();
      }
      return res;
    },
    {},
  );
  // Empty = let the server pick FIFO (the credit expiring soonest). That is the
  // default so near-expiry credits get spent before they lapse; picking a
  // specific one stays available for the cases where it matters.
  const [compOffId, setCompOffId] = useState('');

  return (
    <form action={action} style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: 14 }}>
      <RequestRecipients key={recipientKey} people={people} disabled={pending} />
      <div className="form-row">
        <div className="form-field">
          <label>Use the comp off earned on</label>
          <select
            name="comp_off_id"
            value={compOffId}
            onChange={(e) => setCompOffId(e.target.value)}
          >
            <option value="">Earliest to expire (recommended)</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDate(c.earnedDate)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Take this day off</label>
          {/* A day already past cannot be booked off. IST, not the device
              clock, and applyCompOff re-checks it. */}
          <input name="take_date" type="date" min={todayIST()} required />
        </div>
      </div>

      <div className="form-field">
        <label>Reason (optional)</label>
        <input name="reason" placeholder="e.g. Family commitment" />
      </div>

      {state.error && <div className="error-message">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Comp-off request sent for approval.</div>}

      <button className="button primary" type="submit" disabled={pending}>
        {pending ? 'Applying…' : 'Apply comp off'}
      </button>
    </form>
  );
}

export { MyCompOffs };
