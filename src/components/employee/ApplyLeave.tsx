'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRequest, cancelRequest } from '@/lib/actions/requests';
import { applyCompOff } from '@/lib/actions/comp-off';
import { todayIST } from '@/lib/format';
import Link from 'next/link';
import { RequestRecipients } from '@/components/requests/RequestRecipients';
import { RequestRoutingSummary } from '@/components/requests/RequestRoutingSummary';
import type { LeaveBalanceRow, RequestView } from '@/lib/queries';
import type { RequestType } from '@/types/database';
import type { RequestRecipient } from '@/types/requests';

const typeLabel: Record<RequestType, string> = {
  leave: 'Leave',
  site_visit: 'Site visit',
  outdoor_duty: 'Outdoor duty',
  wfh: 'Work from home',
  comp_off: 'Comp off',
};

// The leave_type enum is a subset of the leave_kind enum, so the labels are not identical.
const typeOptions: RequestType[] = ['leave', 'site_visit', 'outdoor_duty', 'wfh'];
const leaveKindLabel: Record<LeaveBalanceRow['type'], string> = {
  PL: 'Paid leave',
  CL: 'Casual leave',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
};

// CO uses applyCompOff to reserve an earned credit. It is not a leave_type and must not go through
// createRequest.
const leaveKindOptions = [
  { value: 'CO', label: 'Comp off' },
  { value: 'LWP', label: 'Leave without pay' },
] as const;

type LeaveKindChoice = (typeof leaveKindOptions)[number]['value'];

const statusLabel: Record<RequestView['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function statusPillStyle(status: RequestView['status']): React.CSSProperties {
  if (status === 'pending') {
    return { borderColor: 'var(--line-2)', color: 'var(--lm)' };
  }
  if (status === 'approved') {
    return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
  }
  if (status === 'rejected') {
    return { borderColor: 'var(--line-2)', color: 'var(--hd)' };
  }
  return { borderColor: 'var(--line-2)', color: 'var(--ink-3)' };
}

// ISO timestamp -> 'DD MMM YYYY'; null-safe.
function stampDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

// 'DD MMM YYYY' -> 'DD MMM YYYY'; collapses a same-day range.
function dateRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  if (startIso === endIso) {
    return fmt(startIso);
  }
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function ApplyLeave({
  requests,
  balances,
  canApply,
  compOffBalance = 0,
  people,
  id,
}: {
  requests: RequestView[];
  balances: LeaveBalanceRow[];
  canApply: boolean;
  /** Usable comp-off credits (available AND applicable) — the Comp off kind
   *  cannot be filed without one, so the form needs the count up front. */
  compOffBalance?: number;
  people: RequestRecipient[];
  id?: string;
}) {
  return (
    <div className="two-col" id={id}>
      <div className="card">
        <div className="hd">
          <h3>Leave management</h3>
          <span className="folio">apply for leave or duty</span>
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
                    {leaveKindLabel[b.type]}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canApply ? (
            <NewRequestForm compOffBalance={compOffBalance} people={people} />
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
          <h3>Request history &amp; status</h3>
          <span className="folio">
            {requests.filter((r) => r.status === 'pending').length} pending · {requests.length}{' '}
            total
          </span>
        </div>
        <div className="bd">
          {requests.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No requests yet — apply on the left. Every request you submit stays listed here with
              its current status, from submission through approval or rejection.
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
      if (!res.ok) {
        setError(res.error ?? 'Could not cancel the request.');
      } else {
        router.refresh();
      }
    });

  return (
    <div className="policy">
      <div className="phd">
        <h4>
          {typeLabel[request.type]}
          {request.leaveKind ? ` · ${request.leaveKind}` : ''}
        </h4>
        <span className="ver">
          {dateRange(request.startDate, request.endDate)} · {request.days} day
          {request.days === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <span className="pill" style={statusPillStyle(request.status)}>
          {statusLabel[request.status]}
        </span>
        {request.status === 'pending' && (
          <button className="btn" onClick={onCancel} disabled={pending}>
            {pending ? '…' : 'Cancel'}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '2px 0 0' }}>
        Submitted {stampDate(request.createdAt) ?? '—'}
        {request.status === 'pending'
          ? ' · awaiting review'
          : request.reviewedAt
            ? ` · ${statusLabel[request.status].toLowerCase()} ${stampDate(request.reviewedAt)}`
            : request.status === 'cancelled'
              ? ' · withdrawn by you'
              : ''}
      </p>
      {request.reason && <p className="body">{request.reason}</p>}
      <RequestRoutingSummary routing={request.routing} status={request.status} />
      <Link className="btn quiet" href={`/requests/${request.id}`}>
        View request →
      </Link>
      {request.reviewRemark && (request.status === 'approved' || request.status === 'rejected') && (
        <p
          className="body"
          style={{ color: request.status === 'rejected' ? 'var(--hd)' : 'var(--p)' }}
        >
          <b>{request.status === 'approved' ? 'Approved' : 'Rejected'} with note:</b>{' '}
          {request.reviewRemark}
        </p>
      )}
      {error && <div className="login-error">{error}</div>}
    </div>
  );
}

// The parent gates this form with canApply. Keep date bounds in state; read the remaining fields
// from FormData on submit.

function NewRequestForm({
  compOffBalance,
  people,
}: {
  compOffBalance: number;
  people: RequestRecipient[];
}) {
  const router = useRouter();
  const [type, setType] = useState<RequestType>('leave');
  const [leaveKind, setLeaveKind] = useState<LeaveKindChoice>('CO');
  const today = todayIST();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [recipientKey, setRecipientKey] = useState(0);

  const onStartChange = (value: string) => {
    setStartDate(value);
    if (endDate && value && endDate < value) {
      setEndDate(value);
    }
  };

  // The form action is async and returns a JSON object with { ok: boolean, error?: string }.
  // The state is preserved until the drawer is closed, so the user can fix errors and resubmit.
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const takingCompOff = formData.get('type') === 'leave' && formData.get('leave_kind') === 'CO';
      const res = takingCompOff ? await applyCompOff(formData) : await createRequest(formData);
      if (res.ok) {
        setStartDate('');
        setEndDate('');
        setRecipientKey((value) => value + 1);
        router.refresh();
      }
      return res;
    },
    {},
  );

  const takingCompOff = type === 'leave' && leaveKind === 'CO';
  const noCredits = takingCompOff && compOffBalance === 0;

  return (
    <form action={action}>
      <RequestRecipients key={recipientKey} people={people} disabled={pending} />
      <div className="f">
        <label>Request type</label>
        <select name="type" value={type} onChange={(e) => setType(e.target.value as RequestType)}>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {typeLabel[t]}
            </option>
          ))}
        </select>
      </div>

      {type === 'leave' && (
        <div className="f">
          <label>Leave type</label>
          <select
            name="leave_kind"
            value={leaveKind}
            onChange={(e) => setLeaveKind(e.target.value as LeaveKindChoice)}
          >
            {leaveKindOptions.map((k) => (
              <option key={k.value} value={k.value}>
                {k.value} · {k.label}
              </option>
            ))}
          </select>
          {takingCompOff && (
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              {noCredits
                ? 'You have no comp-off credits to use. HR grants one when you work a week-off or holiday.'
                : `${compOffBalance} credit${compOffBalance === 1 ? '' : 's'} available — the one closest to expiring is used first. ` +
                  'Pick a specific credit from the Comp offs card below.'}
            </p>
          )}
        </div>
      )}

      {takingCompOff ? (
        <div className="f">
          <label>Take this day off</label>
          <input name="take_date" type="date" min={today} required />
        </div>
      ) : (
        <div className="f-row">
          <div className="f">
            <label>From</label>
            <input
              name="start_date"
              type="date"
              min={today}
              value={startDate}
              onChange={(e) => onStartChange(e.target.value)}
              required
            />
          </div>
          <div className="f">
            <label>To</label>
            <input
              name="end_date"
              type="date"
              min={startDate || today}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>
      )}

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

      <button
        className="btn primary"
        type="submit"
        disabled={pending || noCredits}
        style={{ marginTop: 4 }}
      >
        {pending ? 'Submitting…' : 'Submit request'}
      </button>
    </form>
  );
}
