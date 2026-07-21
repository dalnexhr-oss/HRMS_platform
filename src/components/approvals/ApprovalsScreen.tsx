'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Stamp } from '@/components/ui/Stamp';
import { reviewRequest } from '@/lib/actions/requests';
import type { RequestView } from '@/lib/queries';

// Map a request type to the register stamp it corresponds to.
const TYPE_STAMP: Record<RequestView['type'], string> = {
  leave: 'L',
  site_visit: 'S',
  outdoor_duty: 'T',
  wfh: 'T',
  comp_off: 'CO',
};

// Human labels for the leave-kind codes stored on a request.
const LEAVE_KIND_LABEL: Record<string, string> = {
  PL: 'Paid leave',
  CL: 'Casual leave',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
};

/** '2026-07-16' -> day-of-month number as a string. */
function dayOf(iso: string): number {
  return new Date(iso + 'T00:00:00').getDate();
}

/** '2026-07-16' -> 'Jul' (short month). */
function monthOf(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
}

/** '2026-07-16'..'2026-07-17' -> '16 – 17 Jul'; spans months when needed. */
function dateRange(startIso: string, endIso: string): string {
  const startMonth = monthOf(startIso);
  const endMonth = monthOf(endIso);
  if (startIso === endIso) return `${dayOf(startIso)} ${startMonth}`;
  if (startMonth === endMonth) return `${dayOf(startIso)} – ${dayOf(endIso)} ${endMonth}`;
  return `${dayOf(startIso)} ${startMonth} – ${dayOf(endIso)} ${endMonth}`;
}

export function ApprovalsScreen({ requests }: { requests: RequestView[] }) {
  // Start with just the pending requests; reviewed cards drop out optimistically.
  const initialPending = useMemo(
    () => requests.filter((r) => r.status === 'pending'),
    [requests],
  );
  const [pending, setPending] = useState<RequestView[]>(initialPending);

  return (
    <div className="wrap grid">
      {pending.length > 0 && (
        <div className="appr">
          {pending.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onReviewed={(id) => setPending((rows) => rows.filter((r) => r.id !== id))}
            />
          ))}
        </div>
      )}

      {pending.length === 0 && (
        <div className="card">
          <div className="empty" style={{ padding: 26 }}>
            <span className="muted" style={{ font: '500 12px var(--mono)' }}>
              Nothing else waiting — leave and outdoor-duty requests land here the moment they&rsquo;re
              raised in the app.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestCard({
  request,
  onReviewed,
}: {
  request: RequestView;
  onReviewed: (id: string) => void;
}) {
  const [busy, startTransition] = useTransition();

  const decide = (decision: 'approved' | 'rejected') => {
    startTransition(async () => {
      const res = await reviewRequest(request.id, decision);
      if (res.ok) onReviewed(request.id);
    });
  };

  return (
    <div className="card req">
      <div className="top">
        <Stamp status={TYPE_STAMP[request.type]} />
        <span className="who-nm">{request.employeeName}</span>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {request.employeeCode} · {request.branch}
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="pill"
          style={{ borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' }}
        >
          Pending
        </span>
      </div>
      <div className="body">{requestSentence(request)}</div>
      <div className="acts">
        <button className="btn primary" onClick={() => decide('approved')} disabled={busy}>
          {busy ? 'Saving…' : 'Approve'}
        </button>
        <button className="btn" onClick={() => decide('rejected')} disabled={busy}>
          Reject
        </button>
        {/* Leave/WFH decisions are cross-checked against the register. Site
            visits and outdoor duty would want a location map, which does not
            exist yet — so no button is shown rather than a dead one. */}
        {(request.type === 'leave' || request.type === 'wfh') && (
          <Link className="btn quiet" href="/register">
            View register
          </Link>
        )}
      </div>
    </div>
  );
}

/** Compose a human sentence describing the request from its fields. */
function requestSentence(r: RequestView) {
  const range = dateRange(r.startDate, r.endDate);
  const reason = r.reason ? <>&ldquo;{r.reason}&rdquo;</> : null;

  if (r.type === 'leave') {
    const kind = (r.leaveKind && LEAVE_KIND_LABEL[r.leaveKind]) || 'Leave';
    return (
      <>
        <b>
          {kind} · {range}
        </b>{' '}
        ({r.days} {r.days === 1 ? 'day' : 'days'})
        {reason && <> — {reason}</>}
        {r.balanceAfter != null && (
          <>
            {' '}
            Balance after approval: <b className="mono">{r.balanceAfter.toFixed(1)}</b>
            {r.leaveKind ? ` ${r.leaveKind}` : ''}.
          </>
        )}
      </>
    );
  }

  if (r.type === 'site_visit') {
    return (
      <>
        <b>Site visit · {range}</b>
        {reason && <> — {reason}</>} Approving lets punches outside the office geofence for these
        dates.
      </>
    );
  }

  if (r.type === 'outdoor_duty') {
    return (
      <>
        <b>Outdoor duty · {range}</b>
        {reason && <> — {reason}</>} Approving lets punches outside the office geofence for these
        dates.
      </>
    );
  }

  if (r.type === 'comp_off') {
    return (
      <>
        <b>Comp off · {range}</b>
        {reason && <> — {reason}</>} Approving spends an earned comp-off credit and stamps this day
        as <b>CO</b> on the register.
      </>
    );
  }

  // wfh
  return (
    <>
      <b>Work from home · {range}</b>
      {reason && <> — {reason}</>} Approving marks these dates as an approved remote day.
    </>
  );
}
