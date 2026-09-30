'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTicket } from '@/lib/actions/helpdesk';
import { TicketChatDrawer } from '@/components/helpdesk/TicketChatDrawer';
import { formatDate } from '@/lib/format';
import type { TicketComment, TicketView } from '@/lib/queries';

const statusLabel: Record<TicketView['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Same pill language as the staff helpdesk screen.
function statusPillStyle(status: TicketView['status']): React.CSSProperties {
  if (status === 'open') {
    return { borderColor: 'var(--border-strong)', color: 'var(--attendance-late)' };
  }
  if (status === 'in_progress') {
    return { borderColor: 'var(--border-strong)', color: 'var(--brand)' };
  }
  return { borderColor: 'var(--attendance-present-border)', color: 'var(--attendance-present)', background: 'var(--attendance-present-background)' };
}

// The employee's own helpdesk tickets, plus a raise-ticket form. Each ticket opens a real-time chat
// window with HR.
function MyTickets({
  tickets,
  comments = {},
  selfId = null,
  canRaise,
  blockedReason,
  id,
}: {
  tickets: TicketView[];
  comments?: Record<string, TicketComment[]>;
  selfId?: string | null;
  canRaise: boolean;
  blockedReason: string;
  id?: string;
}) {
  const [chat, setChat] = useState<TicketView | null>(null);

  return (
    <div className="two-column-layout" id={id}>
      <div className="card">
        <div className="card-header">
          <h3>My tickets</h3>
          <span className="card-caption">{tickets.length} total</span>
        </div>
        <div className="card-body">
          {tickets.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>
              {canRaise ? 'No tickets yet — raise one on the right.' : 'No tickets to show.'}
            </p>
          ) : (
            tickets.map((t) => {
              const count = comments[t.id]?.length ?? 0;
              return (
                <div className="policy" key={t.id}>
                  <div className="entry-header">
                    <h4>{t.subject}</h4>
                    {t.category && <span className="entry-category">{t.category}</span>}
                    <span className="entry-version">{formatDate(t.createdAt.slice(0, 10))}</span>
                    <span style={{ flex: 1 }} />
                    <span className="status-badge" style={statusPillStyle(t.status)}>
                      {statusLabel[t.status]}
                    </span>
                  </div>
                  {t.body && <p className="entry-body">{t.body}</p>}
                  <button
                    type="button"
                    className="button primary"
                    style={{ marginTop: 8 }}
                    onClick={() => setChat(t)}
                  >
                    Open conversation{count > 0 ? ` · ${count}` : ''}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Raise a ticket</h3>
        </div>
        <div className="card-body">
          {canRaise ? (
            <NewTicketForm />
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              {blockedReason}
            </p>
          )}
        </div>
      </div>

      <TicketChatDrawer
        ticket={chat}
        initialComments={chat ? (comments[chat.id] ?? []) : []}
        selfId={selfId}
        isStaff={false}
        open={chat !== null}
        onClose={() => setChat(null)}
      />
    </div>
  );
}

function NewTicketForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await createTicket(formData);
      // createTicket only revalidates /helpdesk, so refresh this route ourselves
      // to pull the new ticket into the list beside the form.
      if (res.ok) {
        router.refresh();
      }
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      <div className="form-field">
        <label>Subject</label>
        <input name="subject" placeholder="e.g. June payslip mismatch" required />
      </div>
      <div className="form-field">
        <label>Category</label>
        <input name="category" placeholder="Payroll / Attendance / General…" />
      </div>
      <div className="form-field">
        <label>Details</label>
        <textarea
          name="body"
          rows={4}
          placeholder="Describe the issue…"
          style={{
            width: '100%',
            padding: '9px 11px',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            font: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
      </div>

      {state.error && <div className="error-message">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Ticket raised.</div>}

      <button className="button primary" type="submit" disabled={pending} style={{ marginTop: 4 }}>
        {pending ? 'Submitting…' : 'Submit ticket'}
      </button>
    </form>
  );
}

export { MyTickets };
