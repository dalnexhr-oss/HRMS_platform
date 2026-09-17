import Link from 'next/link';
import { employeeApprovals } from '@/lib/requests/employee-approvals';
import type { RequestView } from '@/lib/queries';
import type { RequestActor } from '@/lib/requests/access';

export function EmployeeApprovalSummary({
  requests,
  actor,
}: {
  requests: RequestView[];
  actor: RequestActor;
}) {
  const { pending, reviewed, cc } = employeeApprovals(requests, actor);
  return (
    <div className="card" id="request-inbox">
      <div className="hd">
        <h3>Approvals</h3>
        <Link href="/me/approvals" className="btn primary">
          Open approvals →
        </Link>
      </div>
      <div className="bd">
        <p className="muted">Review leave requests sent to you and keep track of your decisions.</p>
        <div className="employee-approval-counts">
          <Link href="/me/approvals?view=pending">
            <b>{pending.length}</b> awaiting your approval
          </Link>
          <Link href="/me/approvals?view=reviewed">
            <b>{reviewed.length}</b> reviewed by you
          </Link>
          <Link href="/me/approvals?view=cc">
            <b>{cc.length}</b> copied to you
          </Link>
        </div>
      </div>
    </div>
  );
}
