import { canReviewRequest } from './access';
import type { RequestActor } from './access';
import type { RequestView } from '@/lib/queries';
import type { EmployeeApprovalView } from '@/types/requests';

/** Keep personal decisions separate from the request's eventual outcome after other reviews. */
export function employeeApprovals(requests: RequestView[], actor: RequestActor) {
  const all = requests
    .filter(
      ({ employeeId, routing }) =>
        employeeId !== actor.employeeId &&
        routing &&
        (routing.initialApprover.id === actor.id ||
          routing.currentApprover.id === actor.id ||
          routing.cc.some((person) => person.id === actor.id) ||
          routing.history.some((step) => step.approver.id === actor.id)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = all.filter((request) => canReviewRequest(request, actor));
  const reviewed = all
    .filter((request) => request.routing!.history.some((step) => step.approver.id === actor.id))
    .sort((a, b) => latestReview(b).localeCompare(latestReview(a)));
  const cc = all.filter((request) => request.routing!.cc.some((person) => person.id === actor.id));

  function latestReview(request: RequestView) {
    return request.routing!.history.filter((step) => step.approver.id === actor.id).at(-1)!
      .decidedAt;
  }
  return { all, pending, reviewed, cc };
}

export const employeeApprovalViews: { value: EmployeeApprovalView; label: string }[] = [
  { value: 'pending', label: 'Awaiting me' },
  { value: 'reviewed', label: 'Reviewed by me' },
  { value: 'cc', label: 'CC' },
  { value: 'all', label: 'All requests' },
];
