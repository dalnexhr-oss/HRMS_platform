import Link from 'next/link';
import { employeeApprovals } from '@/lib/requests/employee-approvals';
import type { RequestView } from '@/lib/queries';
import type { RequestActor } from '@/lib/requests/access';

function EmployeeApprovalSummary({
  requests,
  actor,
}: {
  requests: RequestView[];
  actor: RequestActor;
}) {
  const { pending, reviewed, cc } = employeeApprovals(requests, actor);
  return (
    <div className="card" id="request-inbox">
      <div className="card-header">
        <h3>Approvals</h3>
        <Link href="/employee/approvals" className="button primary">
          Open approvals →
        </Link>
      </div>
      <div className="card-body">
        <p className="text-muted">Review leave requests sent to you and keep track of your decisions.</p>
        <div className="employee-approval-counts">
          <Link href="/employee/approvals?view=pending">
            <b>{pending.length}</b> awaiting your approval
          </Link>
          <Link href="/employee/approvals?view=reviewed">
            <b>{reviewed.length}</b> reviewed by you
          </Link>
          <Link href="/employee/approvals?view=cc">
            <b>{cc.length}</b> copied to you
          </Link>
        </div>
      </div>
    </div>
  );
}

export { EmployeeApprovalSummary };
