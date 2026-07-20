'use client';

import { useActionState, useTransition } from 'react';
import { createTicket, setTicketStatus } from '@/lib/actions/helpdesk';
import type { TicketView } from '@/lib/queries';

type TicketStatus = TicketView['status'];

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_OPTIONS: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

// Colored pill per status: open=amber, in_progress=brand, resolved/closed=green.
function statusPillStyle(status: TicketStatus): React.CSSProperties {
  if (status === 'open') return { borderColor: 'var(--line-2)', color: 'var(--lm)' };
  if (status === 'in_progress') return { borderColor: 'var(--line-2)', color: 'var(--brand)' };
  return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
}

export function HelpdeskScreen({ tickets }: { tickets: TicketView[] }) {
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
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <TicketRow key={t.id} ticket={t} />
                  ))}
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
    </div>
  );
}

function TicketRow({ ticket }: { ticket: TicketView }) {
  const [pending, startTransition] = useTransition();

  const onChange = (status: TicketStatus) => {
    startTransition(async () => {
      await setTicketStatus(ticket.id, status);
    });
  };

  return (
    <tr>
      <td>
        <b>{ticket.subject}</b>
        {ticket.body && (
          <div className="muted" style={{ fontSize: 12 }}>
            {ticket.body}
          </div>
        )}
      </td>
      <td>
        {ticket.employeeName ? (
          <>
            {ticket.employeeName}
            {ticket.employeeCode && (
              <>
                {' '}
                <span className="mono muted">{ticket.employeeCode}</span>
              </>
            )}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>{ticket.category ?? <span className="muted">—</span>}</td>
      <td>
        <span className="pill" style={statusPillStyle(ticket.status)}>
          {STATUS_LABEL[ticket.status]}
        </span>
      </td>
      <td>
        <select
          value={ticket.status}
          disabled={pending}
          onChange={(e) => onChange(e.target.value as TicketStatus)}
          style={{
            padding: '5px 8px',
            border: '1px solid var(--line-2)',
            borderRadius: 8,
            font: 'inherit',
            fontSize: 13,
            background: '#fff',
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
    </tr>
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
