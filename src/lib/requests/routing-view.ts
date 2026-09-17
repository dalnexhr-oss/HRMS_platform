import type { RequestRouteDoc } from '@/lib/db/collections';
import type { RequestRouting } from '@/types/requests';

export function routingView(route: RequestRouteDoc | null | undefined): RequestRouting | null {
  if (!route) {
    return null;
  }
  return {
    initialApprover: route.initial_approver,
    currentApprover: route.current_approver,
    cc: route.cc,
    revision: route.revision,
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
