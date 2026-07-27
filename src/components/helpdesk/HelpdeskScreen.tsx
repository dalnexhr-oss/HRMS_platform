'use client';

import { useActionState, useState } from 'react';
import { createTicket } from '@/lib/actions/helpdesk';
import { TicketChatDrawer } from '@/components/helpdesk/TicketChatDrawer';
import type { TicketComment, TicketView } from '@/lib/queries';

type TicketStatus = TicketView['status'];

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Colored pill per status: open=amber, in_progress=brand, resolved/closed=green.
function statusPillStyle(status: TicketStatus): React.CSSProperties {
  if (status === 'open') return { borderColor: 'var(--line-2)', color: 'var(--lm)' };
  if (status === 'in_progress') return { borderColor: 'var(--line-2)', color: 'var(--brand)' };
  return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
}

export function HelpdeskScreen({
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
    <div className="wrap grid">
      <div className="two-col">
        <div className="card">
          <div className="hd">
            <h3>Support tickets</h3>
            <span className="folio">{tickets.length} total</span>
          </div>
          {tickets.length === 0 ? (
            <div className="bd">
              <div className="empty">
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
                            <div className="muted" style={{ fontSize: 12 }}>
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
                                  <span className="mono muted">{t.employeeCode}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{t.category ?? <span className="muted">—</span>}</td>
                        <td>
                          <span className="pill" style={statusPillStyle(t.status)}>
                            {STATUS_LABEL[t.status]}
                          </span>
                        </td>
                        <td>
                          <button type="button" className="btn primary" onClick={() => setChat(t)}>
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
          <div className="hd">
            <h3>Raise a ticket</h3>
          </div>
          <div className="bd">
            <NewTicketForm />
          </div>
        </div>
      </div>

      <TicketChatDrawer
        ticket={chat}
        initialComments={chat ? comments[chat.id] ?? [] : []}
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
      <div className="f">
        <label>Subject</label>
        <input name="subject" placeholder="e.g. June payslip mismatch" required />
      </div>
      <div className="f">
        <label>Category</label>
        <input name="category" placeholder="Payroll / Attendance / General…" />
      </div>
      <div className="f">
        <label>Details</label>
        <textarea
          name="body"
          rows={5}
          placeholder="Describe the issue…"
          style={{
            width: '100%',
            padding: '9px 11px',
            border: '1px solid var(--line-2)',
            borderRadius: 8,
            font: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
      </div>

      {state.error && <div className="login-error">{state.error}</div>}
      {state.ok && <div className="hint">✓&nbsp; Ticket raised.</div>}

      <button className="btn primary" type="submit" disabled={pending} style={{ marginTop: 4 }}>
        {pending ? 'Submitting…' : 'Submit ticket'}
      </button>
    </form>
  );
}
