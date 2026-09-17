import { isStaffRole } from '@/lib/roles';
import type { AppRole } from '@/types/database';
import type { RequestRouting } from '@/types/requests';

export interface RequestActor {
  id: string;
  employeeId: string | null;
  role: AppRole;
}

/** CC grants visibility, never approval authority. Old unassigned requests retain staff review. */
export function canReviewRequest(
  request: { employeeId: string; status: string; routing: RequestRouting | null },
  actor: RequestActor,
): boolean {
  if (request.status !== 'pending' || request.employeeId === actor.employeeId) {
    return false;
  }
  return request.routing
    ? request.routing.currentApprover.id === actor.id
    : isStaffRole(actor.role);
}
