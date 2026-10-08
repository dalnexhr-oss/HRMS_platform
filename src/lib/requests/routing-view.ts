import type { RequestRouteDoc } from '@/lib/db/collection-registry';
import type { RequestRouting } from '@/types/requests';

function routingView(
  route: RequestRouteDoc | null | undefined,
  // Ids of approvers whose login is disabled or deleted.
  unavailableApprovers: ReadonlySet<string> = new Set(),
): RequestRouting | null {
  if (!route) {
    return null;
  }
  return {
    initialApprover: route.initial_approver,
    currentApprover: route.current_approver,
    cc: route.cc,
    revision: route.revision,
    approverUnavailable: unavailableApprovers.has(route.current_approver.id),
    history: route.history.map((step) => ({
      approver: step.approver,
      decision: step.decision,
      decidedAt:
        step.decided_at instanceof Date ? step.decided_at.toISOString() : String(step.decided_at),
      remark: step.remark,
      forwardedTo: step.forwarded_to,
    })),
  };
}

export { routingView };
