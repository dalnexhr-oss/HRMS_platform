'use client';

import { useActionState, useState } from 'react';
import { createTicket } from '@/lib/actions/helpdesk';
import { TicketChatDrawer } from '@/components/helpdesk/TicketChatDrawer';
import type { TicketComment, TicketView } from '@/lib/queries';

type TicketStatus = TicketView['status'];

const statusLabel: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Colored pill per status: open=amber, in_progress=brand, resolved/closed=green.
function statusPillStyle(status: TicketStatus): React.CSSProperties {
  if (status === 'open') {
    return { borderColor: 'var(--border-strong)', color: 'var(--attendance-late)' };
  }
  if (status === 'in_progress') {
    return { borderColor: 'var(--border-strong)', color: 'var(--brand)' };
  }
  return { borderColor: 'var(--attendance-present-border)', color: 'var(--attendance-present)', background: 'var(--attendance-present-background)' };
}

function HelpdeskScreen({
  tickets,
  comments = {},
  selfId = null,
}: {
  tickets: TicketView[];
  comments?: Record<string, TicketComment[]>;
  selfId?: string | null;
}) {
  const [chat, setChat] = useState<TicketView | null>(null);

  return (
    <div className="content-container grid">
      <div className="two-column-layout">
        <div className="card">
          <div className="card-header">
            <h3>Support tickets</h3>
            <span className="card-caption">{tickets.length} total</span>
          </div>
          {tickets.length === 0 ? (
            <div className="card-body">
              <div className="empty-state">
                <p>No tickets yet — raise one on the right.</p>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Raised by</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Conversation</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => {
                    const count = comments[t.id]?.length ?? 0;
                    return (
                      <tr key={t.id}>
                        <td>
                          <b>{t.subject}</b>
                          {t.body && (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              {t.body}
                            </div>
                          )}
                        </td>
                        <td>
                          {t.employeeName ? (
                            <>
                              {t.employeeName}
                              {t.employeeCode && (
                                <>
                                  {' '}
                                  <span className="text-monospace text-muted">{t.employeeCode}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>{t.category ?? <span className="text-muted">—</span>}</td>
                        <td>
                          <span className="status-badge" style={statusPillStyle(t.status)}>
                            {statusLabel[t.status]}
                          </span>
                        </td>
                        <td>
                          <button type="button" className="button primary" onClick={() => setChat(t)}>
                            Open chat{count > 0 ? ` · ${count}` : ''}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Raise a ticket</h3>
          </div>
          <div className="card-body">
            <NewTicketForm />
          </div>
        </div>
      </div>

      <TicketChatDrawer
        ticket={chat}
        initialComments={chat ? (comments[chat.id] ?? []) : []}
        selfId={selfId}
        isStaff
        open={chat !== null}
        onClose={() => setChat(null)}
      />
    </div>
  );
}

function NewTicketForm() {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => createTicket(formData),
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
          rows={5}
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

export { HelpdeskScreen };
