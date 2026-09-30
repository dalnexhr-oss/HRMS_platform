'use client';

import './requests.css';
import { useRouter } from 'next/navigation';
import { reviewRequest } from '@/lib/actions/requests';
import { canReviewRequest } from '@/lib/requests/access';
import { RecipientPicker } from './RecipientPicker';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/actions/requests';
import type { RequestActor } from '@/lib/requests/access';
import type { RequestView } from '@/lib/queries/requests';
import type { RequestRecipient } from '@/types/requests';

function RequestDecisionControls({
  request,
  actor,
  people,
  onReviewed,
}: {
  request: RequestView;
  actor: RequestActor;
  people: RequestRecipient[];
  onReviewed?: (id: string, result: ActionResult) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [remark, setRemark] = useState('');
  const [shouldForward, setShouldForward] = useState(false);
  const [nextApproverIds, setNextApproverIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!canReviewRequest(request, actor)) {
    return message ? (
      <p className="hint" role="status">
        {message}
      </p>
    ) : null;
  }
  function decide(decision: 'approved' | 'rejected') {
    startTransition(async () => {
      setError('');
      setMessage('');
      try {
        const result = await reviewRequest(
          request.id,
          decision,
          remark,
          decision === 'approved' && shouldForward ? nextApproverIds[0] : undefined,
          request.routing?.revision,
        );
        if (!result.ok) {
          setError(result.error ?? 'Could not review the request.');
          return;
        }
        setMessage(
          result.warning ??
            (result.forwarded
              ? 'Stage approved and forwarded. The request remains pending.'
              : `Request ${decision}.`),
        );
        onReviewed?.(request.id, result);
        router.refresh();
      } catch {
        setError('Could not save the decision. Refresh and try again.');
      }
    });
  }
  return (
    <div className="request-decision">
      <div className="form-field">
        <label htmlFor={`remark-${request.id}`}>Decision note</label>
        <input
          id={`remark-${request.id}`}
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          placeholder="Optional note shared with the applicant and tagged people"
          maxLength={500}
          disabled={busy}
        />
      </div>
      <label className="request-forward-choice">
        <input
          type="checkbox"
          checked={shouldForward}
          disabled={busy}
          onChange={(event) => setShouldForward(event.target.checked)}
        />
        Send to another person for further approval
      </label>
      {shouldForward && (
        <>
          <RecipientPicker
            label="Next approver"
            people={people.filter(
              (person) => person.employeeId !== request.employeeId && person.id !== actor.id,
            )}
            value={nextApproverIds}
            onChange={setNextApproverIds}
            required
            disabled={busy}
          />
          <p className="text-muted">
            Your approval will be recorded. Leave stays pending until the next approver decides.
          </p>
        </>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      <div className="request-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy || (shouldForward && !nextApproverIds.length)}
          onClick={() => decide('approved')}
        >
          {busy ? 'Saving…' : shouldForward ? 'Approve & forward' : 'Approve'}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => decide('rejected')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export { RequestDecisionControls };
