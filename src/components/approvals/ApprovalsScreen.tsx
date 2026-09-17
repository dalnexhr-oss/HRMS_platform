'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Stamp } from '@/components/ui/Stamp';
import { useToast } from '@/components/ui/Toast';
import { canReviewRequest } from '@/lib/requests/access';
import { RequestDecisionControls } from '@/components/requests/RequestDecisionControls';
import { RequestRoutingSummary } from '@/components/requests/RequestRoutingSummary';
import { RequestInbox } from '@/components/requests/RequestInbox';
import type { RequestActor } from '@/lib/requests/access';
import type { RequestRecipient } from '@/types/requests';
import type { RequestView } from '@/lib/queries';

// Map a request type to the register stamp it corresponds to.
const typeStamp: Record<RequestView['type'], string> = {
  leave: 'L',
  site_visit: 'S',
  outdoor_duty: 'T',
  wfh: 'T',
  comp_off: 'CO',
};

// Human labels for the leave-kind codes stored on a request.
const leaveKindLabel: Record<string, string> = {
  CL: 'Casual leave',
  CO: 'Comp Off',
  SL: 'Sick leave',
  LWP: 'Leave without pay',
  LOP: 'Leave of pay',
};

// 'yyyy-MM-dd' -> day-of-month number as a string.
function dayOf(iso: string): number {
  return new Date(`${iso}T00:00:00`).getDate();
}

// 'yyyy-MM-dd' -> 'Jul' (short month).
function monthOf(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

// 'yyyy-MM-dd'..'yyyy-MM-dd' -> '1 Jul – 3 Jul' or '1 Jul – 3 Aug' or '1 Jul' depending on the range.
function dateRange(startIso: string, endIso: string): string {
  const startMonth = monthOf(startIso);
  const endMonth = monthOf(endIso);
  if (startIso === endIso) {
    return `${dayOf(startIso)} ${startMonth}`;
  }
  if (startMonth === endMonth) {
    return `${dayOf(startIso)} – ${dayOf(endIso)} ${endMonth}`;
  }
  return `${dayOf(startIso)} ${startMonth} – ${dayOf(endIso)} ${endMonth}`;
}

export function ApprovalsScreen({
  requests,
  actor,
  people,
}: {
  requests: RequestView[];
  actor: RequestActor;
  people: RequestRecipient[];
}) {
  const { toast, toastNode } = useToast();
  // Start with just the pending requests; reviewed cards drop out optimistically.
  const initialPending = useMemo(
    () => requests.filter((r) => canReviewRequest(r, actor)),
    [requests, actor],
  );
  const [pending, setPending] = useState<RequestView[]>(initialPending);

  // Resync when server rows change while retaining optimistic removals between updates.
  useEffect(() => {
    setPending(initialPending);
  }, [initialPending]);

  return (
    <div className="wrap grid">
      {toastNode}
      {pending.length > 0 && (
        <div className="appr">
          {pending.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              actor={actor}
              people={people}
              onReviewed={(id) => setPending((rows) => rows.filter((r) => r.id !== id))}
              toast={toast}
            />
          ))}
        </div>
      )}

      {pending.length === 0 && (
        <div className="card">
          <div className="empty" style={{ padding: 26 }}>
            <span className="muted" style={{ font: '500 12px var(--mono)' }}>
              No requests are waiting for your approval.
            </span>
          </div>
        </div>
      )}
      <RequestInbox requests={requests} userId={actor.id} />
    </div>
  );
}

function RequestCard({
  request,
  actor,
  people,
  onReviewed,
  toast,
}: {
  request: RequestView;
  actor: RequestActor;
  people: RequestRecipient[];
  onReviewed: (id: string) => void;
  toast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}) {
  return (
    <div className="card req">
      <div className="top">
        <Stamp status={typeStamp[request.type]} />
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
      <div className="bd">
        <RequestRoutingSummary routing={request.routing} status={request.status} />
        <RequestDecisionControls
          request={request}
          actor={actor}
          people={people}
          onReviewed={(id, result) => {
            onReviewed(id);
            toast(
              result.warning ??
                (result.forwarded
                  ? 'Stage approved and forwarded for further approval.'
                  : 'Decision saved.'),
              result.warning ? 'info' : 'success',
            );
          }}
        />
      </div>
      <div className="acts" style={{ flexWrap: 'wrap' }}>
        <Link className="btn quiet" href={`/requests/${request.id}`}>
          View request →
        </Link>
        {/* Leave/WFH decisions are cross-checked against the register. Site visits and outdoor duty would want a location map, which does not exist yet — so no button is shown rather than a dead one. */}
        {(request.type === 'leave' || request.type === 'wfh') && (
          <Link className="btn quiet" href="/register">
            View register
          </Link>
        )}
      </div>
    </div>
  );
}

// Compose a human sentence describing the request from its fields.
function requestSentence(r: RequestView) {
  const range = dateRange(r.startDate, r.endDate);
  const reason = r.reason ? <>&ldquo;{r.reason}&rdquo;</> : null;

  if (r.type === 'leave') {
    const kind = (r.leaveKind && leaveKindLabel[r.leaveKind]) || 'Leave';
    return (
      <>
        <b>
          {kind} · {range}
        </b>{' '}
        ({r.days} {r.days === 1 ? 'day' : 'days'}){reason && <> — {reason}</>}
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
        {reason && <> — {reason}</>} Approving records these dates as sanctioned off-site work.
      </>
    );
  }

  if (r.type === 'outdoor_duty') {
    return (
      <>
        <b>Outdoor duty · {range}</b>
        {reason && <> — {reason}</>} Approving records these dates as sanctioned off-site work.
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
