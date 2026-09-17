import Link from 'next/link';
import type { RequestView } from '@/lib/queries';

export function RequestInbox({ requests, userId }: { requests: RequestView[]; userId: string }) {
  const received = requests.filter(
    ({ routing }) =>
      routing &&
      (routing.initialApprover.id === userId ||
        routing.currentApprover.id === userId ||
        routing.cc.some((person) => person.id === userId) ||
        routing.history.some((step) => step.approver.id === userId)),
  );
  if (!received.length) {
    return null;
  }
  return (
    <div className="card" id="request-inbox">
      <div className="hd">
        <h3>Requests sent to you</h3>
        <span className="folio">Assigned · CC · earlier reviews</span>
      </div>
      <div className="bd request-inbox">
        {received.map((request) => (
          <Link key={request.id} href={`/requests/${request.id}`} className="request-inbox-row">
            <div>
              <b>{request.employeeName}</b>
              <div>
                {request.type.replaceAll('_', ' ')} · {request.startDate} – {request.endDate}
              </div>
            </div>
            <span>
              {request.status === 'pending' && request.routing?.currentApprover.id === userId
                ? 'Your approval needed'
                : request.status}
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
