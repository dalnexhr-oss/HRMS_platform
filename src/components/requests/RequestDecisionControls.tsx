'use client';

import { useRouter } from 'next/navigation';
import { reviewRequest } from '@/lib/actions/requests';
import { canReviewRequest } from '@/lib/requests/access';
import { RecipientPicker } from './RecipientPicker';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/actions/requests';
import type { RequestActor } from '@/lib/requests/access';
import type { RequestView } from '@/lib/queries';
import type { RequestRecipient } from '@/types/requests';

export function RequestDecisionControls({
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
  const [forward, setForward] = useState(false);
  const [next, setNext] = useState<string[]>([]);
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
          decision === 'approved' && forward ? next[0] : undefined,
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
      <div className="f">
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
          checked={forward}
          disabled={busy}
          onChange={(event) => setForward(event.target.checked)}
        />
        Send to another person for further approval
      </label>
      {forward && (
        <>
          <RecipientPicker
            label="Next approver"
            people={people.filter(
              (person) => person.employeeId !== request.employeeId && person.id !== actor.id,
            )}
            value={next}
            onChange={setNext}
            required
            disabled={busy}
          />
          <p className="muted">
            Your approval will be recorded. Leave stays pending until the next approver decides.
          </p>
        </>
      )}
      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      <div className="acts">
        <button
          type="button"
          className="btn primary"
          disabled={busy || (forward && !next.length)}
          onClick={() => decide('approved')}
        >
          {busy ? 'Saving…' : forward ? 'Approve & forward' : 'Approve'}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => decide('rejected')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
