'use client';

import { useState } from 'react';
import Link from 'next/link';
import { employeeApprovals, employeeApprovalViews } from '@/lib/requests/employee-approvals';
import { RequestDecisionControls } from '@/components/requests/RequestDecisionControls';
import { formatDate } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import type { RequestActor } from '@/lib/requests/access';
import type { EmployeeApprovalView, RequestRecipient } from '@/types/requests';
import type { RequestView } from '@/lib/queries';

const typeLabels: Record<RequestView['type'], string> = {
  leave: 'Leave',
  comp_off: 'Comp off',
  site_visit: 'Site visit',
  outdoor_duty: 'Outdoor duty',
  wfh: 'Work from home',
};
const emptyMessages: Record<EmployeeApprovalView, string> = {
  pending: 'No requests are waiting for your approval.',
  reviewed:
    'You have not reviewed any requests yet. Your approvals, rejections, and handoffs will appear here.',
  cc: 'You have not been cc on any requests yet.',
  all: 'Requests sent to you for approval or copied to you will appear here.',
};

export function EmployeeApprovals({
  requests,
  actor,
  people,
  view = 'pending',
}: {
  requests: RequestView[];
  actor: RequestActor;
  people: RequestRecipient[];
  view?: EmployeeApprovalView;
}) {
  const [query, setQuery] = useState('');
  const { toast, toastNode } = useToast();
  const groups = employeeApprovals(requests, actor);
  const search = query.trim().toLowerCase();
  const visible = groups[view].filter((request) =>
    `${request.employeeName} ${request.employeeCode} ${request.branch} ${typeLabels[request.type]} ${request.leaveKind ?? ''} ${request.startDate} ${request.endDate} ${request.status}`
      .toLowerCase()
      .includes(search),
  );
  return (
    <div className="wrap grid employee-approvals">
      {toastNode}
      <div className="card">
        <div className="hd">
          <h3>My approvals</h3>
          <span className="folio">{groups.pending.length} awaiting your decision</span>
        </div>
        <div className="bd">
          <p className="muted">
            Review requests assigned to you and track the leave you have approved, rejected, or
            forwarded.
          </p>
          <nav className="employee-approval-filters" aria-label="Approval views">
            {employeeApprovalViews.map(({ value, label }) => (
              <Link
                key={value}
                href={`/me/approvals?view=${value}`}
                className={`btn ${view === value ? 'primary' : 'quiet'}`}
                aria-current={view === value ? 'page' : undefined}
              >
                {label} ({groups[value].length})
              </Link>
            ))}
          </nav>
          <div className="f">
            <label htmlFor="approval-search">Search requests</label>
            <input
              id="approval-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Employee name, code, leave date, or status"
            />
          </div>
          <p className="muted" role="status">
            {visible.length} request{visible.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {visible.length === 0 && (
        <div className="card">
          <div className="bd muted">
            {search ? 'No requests match your search.' : emptyMessages[view]}
          </div>
        </div>
      )}
      {visible.map((request) => {
        const myReviews = request.routing!.history.filter((step) => step.approver.id === actor.id);
        return (
          <article className="card employee-approval-card" key={request.id}>
            <div className="hd">
              <h3>{request.employeeName}</h3>
              <span className={`pill approval-status-${request.status}`}>
                Request: {request.status}
              </span>
            </div>
            <div className="bd">
              <p className="muted">
                {[request.employeeCode, request.branch].filter(Boolean).join(' · ')}
              </p>
              <p>
                <b>
                  {typeLabels[request.type]}
                  {request.leaveKind ? ` · ${request.leaveKind}` : ''}
                </b>{' '}
                · {formatDate(request.startDate)}
                {request.startDate !== request.endDate
                  ? ` – ${formatDate(request.endDate)}`
                  : ''} · {request.days} day{request.days === 1 ? '' : 's'}
              </p>
              {request.reason && <p className="employee-approval-reason">{request.reason}</p>}
              {request.status === 'pending' && (
                <p className="request-awaiting">
                  Awaiting{' '}
                  {request.routing!.currentApprover.id === actor.id
                    ? 'your'
                    : `${request.routing!.currentApprover.name}'s`}{' '}
                  approval
                </p>
              )}
              {myReviews.length > 0 && (
                <div className="employee-approval-history">
                  <h4>Your review history</h4>
                  <ol>
                    {myReviews.map((step, index) => (
                      <li key={index}>
                        <b>
                          {step.forwardedTo
                            ? `Approved this stage & forwarded to ${step.forwardedTo.name}`
                            : step.decision === 'approved'
                              ? 'Approved by you'
                              : 'Rejected by you'}
                        </b>
                        <time dateTime={step.decidedAt}>
                          {new Date(step.decidedAt).toLocaleString('en-GB', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}{' '}
                          IST
                        </time>
                        {step.remark && <p>{step.remark}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Link href={`/requests/${request.id}`} className="btn quiet">
                View request & full history →
              </Link>
              <RequestDecisionControls
                request={request}
                actor={actor}
                people={people}
                onReviewed={(_id, result) =>
                  toast(
                    result.warning ??
                      (result.forwarded
                        ? 'Stage approved and forwarded. Saved in Reviewed by me.'
                        : 'Decision saved in Reviewed by me.'),
                    result.warning ? 'info' : 'success',
                  )
                }
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}
