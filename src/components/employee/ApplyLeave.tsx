'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRequest, cancelRequest } from '@/lib/actions/requests';
import type { LeaveBalanceRow, RequestView } from '@/lib/queries';
import type { RequestType } from '@/types/database';

const TYPE_LABEL: Record<RequestType, string> = {
  leave: 'Leave',
  site_visit: 'Site visit',
  outdoor_duty: 'Outdoor duty',
  wfh: 'Work from home',
};

const TYPE_OPTIONS: RequestType[] = ['leave', 'site_visit', 'outdoor_duty', 'wfh'];

const LEAVE_KIND_LABEL: Record<LeaveBalanceRow['type'], string> = {
  PL: 'Paid leave',
  CL: 'Casual leave',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
};

const LEAVE_KIND_OPTIONS: LeaveBalanceRow['type'][] = ['PL', 'CL', 'SL', 'LWP'];

const STATUS_LABEL: Record<RequestView['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function statusPillStyle(status: RequestView['status']): React.CSSProperties {
  if (status === 'pending') return { borderColor: 'var(--line-2)', color: 'var(--lm)' };
  if (status === 'approved')
    return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
  if (status === 'rejected') return { borderColor: 'var(--line-2)', color: 'var(--hd)' };
  return { borderColor: 'var(--line-2)', color: 'var(--ink-3)' };
}

/** '2026-07-16' -> '16 Jul'; collapses a same-day range. */
function dateRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  if (startIso === endIso) return fmt(startIso);
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function ApplyLeave({
  requests,
  balances,
  canApply,
}: {
  requests: RequestView[];
  balances: LeaveBalanceRow[];
  canApply: boolean;
}) {
  return (
    <div className="two-col">
      <div className="card">
        <div className="hd">
          <h3>Apply for leave or duty</h3>
        </div>
        <div className="bd">
          {balances.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
                paddingBottom: 14,
                marginBottom: 14,
                borderBottom: '1px dashed var(--line)',
              }}
            >
              {balances.map((b) => (
                <div key={b.type}>
                  <div
                    style={{
                      font: '600 10px var(--mono)',
                      letterSpacing: '.12em',
                      color: 'var(--ink-3)',
                    }}
                  >
                    {b.type}
                  </div>
                  <div style={{ font: '600 18px var(--mono)', color: 'var(--brand-deep)' }}>
                    {b.balance}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {LEAVE_KIND_LABEL[b.type]}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canApply ? (
            <NewRequestForm />
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Your login is not linked to an employee record, so requests cannot be filed. Ask HR to
              link it.
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>My requests</h3>
          <span className="folio">{requests.length} total</span>
        </div>
        <div className="bd">
          {requests.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No requests yet — apply on the left.
            </p>
          ) : (
            requests.map((r) => <RequestItem key={r.id} request={r} />)
          )}
        </div>
      </div>
    </div>
  );
}

function RequestItem({ request }: { request: RequestView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onCancel = () =>
    startTransition(async () => {
      setError(null);
      const res = await cancelRequest(request.id);
      if (!res.ok) setError(res.error ?? 'Could not cancel the request.');
      else router.refresh();
    });

  return (
    <div className="policy">
      <div className="phd">
        <h4>
          {TYPE_LABEL[request.type]}
          {request.leaveKind ? ` · ${request.leaveKind}` : ''}
        </h4>
        <span className="ver">
          {dateRange(request.startDate, request.endDate)} · {request.days} day
          {request.days === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <span className="pill" style={statusPillStyle(request.status)}>
          {STATUS_LABEL[request.status]}
        </span>
        {request.status === 'pending' && (
          <button className="btn" onClick={onCancel} disabled={pending}>
            {pending ? '…' : 'Cancel'}
          </button>
        )}
      </div>
      {request.reason && <p className="body">{request.reason}</p>}
      {error && <div className="login-error">{error}</div>}
    </div>
  );
}

function NewRequestForm() {
  const router = useRouter();
  const [type, setType] = useState<RequestType>('leave');
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await createRequest(formData);
      // createRequest revalidates /me, but refresh keeps the list in step even
      // when this form is rendered inside an unchanged cached segment.
      if (res.ok) router.refresh();
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      <div className="f">
        <label>Request type</label>
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as RequestType)}
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {type === 'leave' && (
        <div className="f">
          <label>Leave type</label>
          <select name="leave_kind" defaultValue="PL">
            {LEAVE_KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k} · {LEAVE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="f-row">
        <div className="f">
          <label>From</label>
          <input name="start_date" type="date" required />
        </div>
        <div className="f">
          <label>To</label>
          <input name="end_date" type="date" required />
        </div>
      </div>

      <div className="f">
        <label>Reason</label>
        <textarea
          name="reason"
          rows={4}
          placeholder="Why are you applying?"
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
      {state.ok && <div className="hint">✓&nbsp; Request submitted for approval.</div>}

      <button className="btn primary" type="submit" disabled={pending} style={{ marginTop: 4 }}>
        {pending ? 'Submitting…' : 'Submit request'}
      </button>
    </form>
  );
}
