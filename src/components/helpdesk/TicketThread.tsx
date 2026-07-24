'use client';

// A two-way follow-up thread on one ticket. Used by both the staff helpdesk
// screen and the employee dashboard. Posting is wired to addTicketComment; an
// employee posting on a resolved/closed ticket reopens it (handled server-side).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addTicketComment } from '@/lib/actions/helpdesk';
import { formatDate } from '@/lib/format';
import type { TicketComment } from '@/lib/queries';

export function TicketThread({
  ticketId,
  comments,
}: {
  ticketId: string;
  comments: TicketComment[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const res = await addTicketComment(ticketId, text);
      if (!res.ok) setError(res.error ?? 'Could not post the follow-up.');
      else {
        setBody('');
        router.refresh();
      }
    });
  }

  return (
    <div style={{ marginTop: 8 }}>
      {comments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {comments.map((c) => (
            <div
              key={c.id}
              style={{
                fontSize: 12,
                padding: '6px 9px',
                borderLeft: `3px solid ${c.authorIsStaff ? 'var(--brand)' : 'var(--line-2)'}`,
                background: 'var(--brand-soft)',
                borderRadius: 4,
              }}
            >
              <b>
                {c.authorIsStaff
                  ? c.authorName
                    ? `${c.authorName} · HR`
                    : 'HR'
                  : c.authorName ?? 'Employee'}
                :
              </b>{' '}
              {c.body}
              <span className="mono muted" style={{ marginLeft: 6, fontSize: 10 }}>
                {formatDate(c.createdAt.slice(0, 10))}
              </span>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a follow-up…"
        rows={2}
        disabled={pending}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid var(--line-2)',
          borderRadius: 8,
          font: 'inherit',
          fontSize: 12,
          background: '#fff',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button
          type="button"
          className="btn quiet"
          disabled={pending || !body.trim()}
          onClick={submit}
        >
          {pending ? 'Posting…' : 'Post follow-up'}
        </button>
        {error && (
          <span className="login-error" style={{ fontSize: 11 }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
