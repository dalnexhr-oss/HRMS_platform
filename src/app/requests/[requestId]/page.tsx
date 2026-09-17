import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession, homeForRole, isStaffRole } from '@/lib/auth';
import { getRequest } from '@/lib/queries';
import { getRequestRecipients } from '@/lib/requests/routing';
import { canReviewRequest } from '@/lib/requests/access';
import { RequestRoutingSummary } from '@/components/requests/RequestRoutingSummary';
import { RequestDecisionControls } from '@/components/requests/RequestDecisionControls';

export default async function RequestPage({ params }: { params: Promise<{ requestId: string }> }) {
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
    <main className="wrap grid request-detail">
      <Link
        className="btn quiet"
        href={employeeReviewer ? '/me/approvals?view=all' : homeForRole(profile.role)}
      >
        ← Back to {employeeReviewer ? 'my approvals' : 'dashboard'}
      </Link>
      <div className="card">
        <div className="hd">
          <h3>{request.type.replaceAll('_', ' ')} request</h3>
          <span className="pill">{request.status}</span>
        </div>
        <div className="bd">
          <h2>{request.employeeName}</h2>
          <p className="muted">
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
