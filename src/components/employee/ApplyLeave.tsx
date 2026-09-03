'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRequest, cancelRequest } from '@/lib/actions/requests';
import { applyCompOff } from '@/lib/actions/compoff';
import type { LeaveBalanceRow, RequestView } from '@/lib/queries';
import type { RequestType } from '@/types/database';

const TYPE_LABEL: Record<RequestType, string> = {
  leave: 'Leave',
  site_visit: 'Site visit',
  outdoor_duty: 'Outdoor duty',
  wfh: 'Work from home',
  comp_off: 'Comp off',
};

// 'comp_off' is deliberately NOT offered here: a comp off must be applied for
// against a specific earned credit, which the CompOffs card handles.
const TYPE_OPTIONS: RequestType[] = ['leave', 'site_visit', 'outdoor_duty', 'wfh'];

// All four keys stay: historic requests still render their CL/SL tag. Only
// LEAVE_KIND_OPTIONS below decides what a NEW request may carry — one paid
// pool + leave-without-pay since the leave-salary policy.
const LEAVE_KIND_LABEL: Record<LeaveBalanceRow['type'], string> = {
  PL: 'Paid leave',
  CL: 'Casual leave',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
};

/**
 * What a NEW leave request may be filed as.
 *
 * 'CO' is deliberately not a LeaveType: comp off is absent from the leave_type
 * enum, so createRequest rejects it as a leave_kind. Picking it here files a
 * comp-off application against an earned credit via applyCompOff instead —
 * the only way a comp off can be taken, because the credit has to be claimed so
 * it cannot be spent twice.
 */
const LEAVE_KIND_OPTIONS = [
  { value: 'CO', label: 'Comp off' },
  { value: 'LWP', label: 'Leave without pay' },
] as const;

type LeaveKindChoice = (typeof LEAVE_KIND_OPTIONS)[number]['value'];

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

/** ISO timestamp -> '12 Aug 2026'; null-safe. */
function stampDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
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
  compOffBalance = 0,
  id,
}: {
  requests: RequestView[];
  balances: LeaveBalanceRow[];
  canApply: boolean;
  /** Usable comp-off credits (available AND applicable) — the Comp off kind
   *  cannot be filed without one, so the form needs the count up front. */
  compOffBalance?: number;
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
                    {LEAVE_KIND_LABEL[b.type]}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canApply ? (
            <NewRequestForm compOffBalance={compOffBalance} />
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
            {requests.filter((r) => r.status === 'pending').length} pending · {requests.length} total
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
      <p className="muted" style={{ fontSize: 11, margin: '2px 0 0' }}>
        Submitted {stampDate(request.createdAt) ?? '—'}
        {request.status === 'pending'
          ? ' · awaiting review'
          : request.reviewedAt
            ? ` · ${STATUS_LABEL[request.status].toLowerCase()} ${stampDate(request.reviewedAt)}`
            : request.status === 'cancelled'
              ? ' · withdrawn by you'
              : ''}
      </p>
      {request.reason && <p className="body">{request.reason}</p>}
      {request.reviewRemark && (request.status === 'approved' || request.status === 'rejected') && (
        <p className="body" style={{ color: request.status === 'rejected' ? 'var(--hd)' : 'var(--p)' }}>
          <b>{request.status === 'approved' ? 'Approved' : 'Rejected'} with note:</b>{' '}
          {request.reviewRemark}
        </p>
      )}
      {error && <div className="login-error">{error}</div>}
    </div>
  );
}

function NewRequestForm({ compOffBalance }: { compOffBalance: number }) {
  const router = useRouter();
  const [type, setType] = useState<RequestType>('leave');
  const [leaveKind, setLeaveKind] = useState<LeaveKindChoice>('CO');
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      // A comp off is an application against an earned credit, not a leave kind,
      // so it goes to applyCompOff. The intent is read off the FormData rather
      // than component state so a submit can never race a re-render.
      const takingCompOff =
        formData.get('type') === 'leave' && formData.get('leave_kind') === 'CO';
      const res = takingCompOff ? await applyCompOff(formData) : await createRequest(formData);
      // The actions revalidate /me, but refresh keeps the list in step even
      // when this form is rendered inside an unchanged cached segment.
      if (res.ok) router.refresh();
      return res;
    },
    {},
  );

  const takingCompOff = type === 'leave' && leaveKind === 'CO';
  const noCredits = takingCompOff && compOffBalance === 0;

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
          <select
            name="leave_kind"
            value={leaveKind}
            onChange={(e) => setLeaveKind(e.target.value as LeaveKindChoice)}
          >
            {LEAVE_KIND_OPTIONS.map((k) => (
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

      {/* One credit buys one day off, so a comp off takes a single date rather
          than a range — matching what applyCompOff accepts. */}
      {takingCompOff ? (
        <div className="f">
          <label>Take this day off</label>
          <input name="take_date" type="date" required />
        </div>
      ) : (
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
