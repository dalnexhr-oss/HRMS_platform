import type { RequestRouting } from '@/types/requests';

export function RequestRoutingSummary({
  routing,
  status,
}: {
  routing: RequestRouting | null;
  status: string;
}) {
  if (!routing) {
    return null;
  }
  return (
    <div className="request-routing">
      <p>
        <b>To:</b> <span title={routing.initialApprover.email}>{routing.initialApprover.name}</span>
      </p>
      {routing.cc.length > 0 && (
        <p>
          <b>CC:</b> {routing.cc.map((person) => person.name).join(', ')}
        </p>
      )}
      {status === 'pending' && (
        <p className="request-awaiting">Awaiting {routing.currentApprover.name}&apos;s approval</p>
      )}
      {routing.history.length > 0 && (
        <details>
          <summary>
            Approval history · {routing.history.length} decision
            {routing.history.length === 1 ? '' : 's'}
          </summary>
          <ol>
            {routing.history.map((step, index) => (
              <li key={index}>
                <b>{step.approver.name}</b> {step.decision}
                {step.forwardedTo
                  ? ` this stage and forwarded to ${step.forwardedTo.name}`
                  : ' the request'}
                <div className="muted">
                  {new Date(step.decidedAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  IST
                </div>
                {step.remark && <div>{step.remark}</div>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
