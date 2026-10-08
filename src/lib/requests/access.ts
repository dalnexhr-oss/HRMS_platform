import { isStaffRole } from '@/lib/user-roles';
import type { AppRole } from '@/types/database';
import type { RequestRouting } from '@/types/requests';

interface RequestActor {
  id: string;
  employeeId: string | null;
  role: AppRole;
}

/**
 * CC grants visibility, never approval authority. Old unassigned requests retain staff review, and
 * staff may also decide a request whose assigned approver can no longer sign in.
 */
function canReviewRequest(
  request: { employeeId: string; status: string; routing: RequestRouting | null },
  actor: RequestActor,
): boolean {
  if (request.status !== 'pending' || request.employeeId === actor.employeeId) {
    return false;
  }
  if (!request.routing) {
    return isStaffRole(actor.role);
  }
  return (
    request.routing.currentApprover.id === actor.id ||
    (request.routing.approverUnavailable && isStaffRole(actor.role))
  );
}

export { canReviewRequest };
export { type RequestActor };
