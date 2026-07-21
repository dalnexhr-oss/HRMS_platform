'use client';

// Comp-off credits earned by working a week-off or holiday, plus the form to
// apply for a day off against one. Applying raises a request that HR approves;
// on approval the taken day is stamped CO and the credit is marked used.
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { applyCompOff } from '@/lib/actions/compoff';
import type { CompOffRow } from '@/lib/queries';

const STATUS_LABEL: Record<CompOffRow['status'], string> = {
  available: 'Available',
  applied: 'Applied — awaiting approval',
  used: 'Used',
  expired: 'Expired',
};

function pillStyle(status: CompOffRow['status']): React.CSSProperties {
  if (status === 'available') return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
  if (status === 'applied') return { borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' };
  return { borderColor: 'var(--line-2)', color: 'var(--ink-3)' };
}

export function MyCompOffs({
  compOffs,
  canApply,
  blockedReason,
}: {
  compOffs: CompOffRow[];
  canApply: boolean;
  blockedReason: string;
}) {
  const available = compOffs.filter((c) => c.status === 'available');

  return (
    <div className="card">
      <div className="hd">
        <h3>Comp offs</h3>
        <span className="folio">
          {available.length} available · {compOffs.length} earned
        </span>
      </div>
      <div className="bd">
        {compOffs.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No comp offs yet. When you work on a week-off or holiday, HR can grant you a comp-off
            credit from the register — it will appear here to use.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {compOffs.map((c) => (
                <span key={c.id} className="pill" style={pillStyle(c.status)}>
                  Earned {formatDate(c.earnedDate)} · {STATUS_LABEL[c.status]}
                  {c.usedDate && c.status === 'used' ? ` (taken ${formatDate(c.usedDate)})` : ''}
                </span>
              ))}
            </div>

            {available.length > 0 &&
              (canApply ? (
                <ApplyForm available={available} />
              ) : (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  {blockedReason}
                </p>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function ApplyForm({ available }: { available: CompOffRow[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await applyCompOff(formData);
      if (res.ok) router.refresh();
      return res;
    },
    {},
  );
  const [compOffId, setCompOffId] = useState(available[0]?.id ?? '');

  return (
    <form action={action} style={{ borderTop: '1px dashed var(--line)', paddingTop: 14 }}>
      <div className="f-row">
        <div className="f">
          <label>Use the comp off earned on</label>
          <select name="comp_off_id" value={compOffId} onChange={(e) => setCompOffId(e.target.value)}>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDate(c.earnedDate)}
              </option>
            ))}
          </select>
        </div>
        <div className="f">
          <label>Take this day off</label>
          <input name="take_date" type="date" required />
        </div>
      </div>

      <div className="f">
        <label>Reason (optional)</label>
        <input name="reason" placeholder="e.g. Family commitment" />
      </div>

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Comp-off request sent for approval.</div>}

      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Applying…' : 'Apply comp off'}
      </button>
    </form>
  );
}
