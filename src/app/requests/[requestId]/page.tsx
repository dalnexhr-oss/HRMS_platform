import './request.css';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession, homeForRole, isStaffRole } from '@/lib/server-auth';
import { getRequest } from '@/lib/server-queries';
import { getRequestRecipients } from '@/lib/requests/routing';
import { canReviewRequest } from '@/lib/requests/access';
import { RequestRoutingSummary } from '@/components/requests/RequestRoutingSummary';
import { RequestDecisionControls } from '@/components/requests/RequestDecisionControls';

async function RequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { profile } = await getSession();
  if (!profile) {
    redirect('/login');
  }
  const { requestId } = await params;
  const request = await getRequest(requestId);
  if (!request) {
    notFound();
  }
  const actor = { id: profile.id, employeeId: profile.employee_id, role: profile.role };
  const people = canReviewRequest(request, actor) ? await getRequestRecipients() : [];
  const employeeReviewer = !isStaffRole(profile.role) && request.employeeId !== profile.employee_id;
  return (
    <main className="content-container grid request-detail">
      <Link
        className="button quiet"
        href={employeeReviewer ? '/employee/approvals?view=all' : homeForRole(profile.role)}
      >
        ← Back to {employeeReviewer ? 'my approvals' : 'dashboard'}
      </Link>
      <div className="card">
        <div className="card-header">
          <h3>{request.type.replaceAll('_', ' ')} request</h3>
          <span className="status-badge">{request.status}</span>
        </div>
        <div className="card-body">
          <h2>{request.employeeName}</h2>
          <p className="text-muted">
            {request.employeeCode} · {request.branch}
          </p>
          <p>
            <b>
              {request.startDate} – {request.endDate}
            </b>{' '}
            · {request.days} day{request.days === 1 ? '' : 's'}
            {request.leaveKind ? ` · ${request.leaveKind}` : ''}
          </p>
          {request.reason && <p style={{ whiteSpace: 'pre-wrap' }}>{request.reason}</p>}
          <RequestRoutingSummary routing={request.routing} status={request.status} />
          {!request.routing && request.reviewRemark && (
            <p>
              <b>Decision note:</b> {request.reviewRemark}
            </p>
          )}
          <RequestDecisionControls request={request} actor={actor} people={people} />
        </div>
      </div>
    </main>
  );
}

export { RequestPage as default };
