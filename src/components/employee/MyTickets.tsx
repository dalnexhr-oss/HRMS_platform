'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createTicket } from '@/lib/actions/helpdesk';
import { formatDate } from '@/lib/format';
import type { TicketView } from '@/lib/queries';

const STATUS_LABEL: Record<TicketView['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Same pill language as the staff helpdesk screen.
function statusPillStyle(status: TicketView['status']): React.CSSProperties {
  if (status === 'open') return { borderColor: 'var(--line-2)', color: 'var(--lm)' };
  if (status === 'in_progress') return { borderColor: 'var(--line-2)', color: 'var(--brand)' };
  return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
}

/**
 * The employee's own helpdesk tickets, plus a raise-ticket form.
 *
 * `canRaise` is decided on the server: `createTicket` stamps the ticket with the
 * session's employee_id and short-circuits to a bare {ok:true} when Supabase is
 * unconfigured, so in either failing case the form would report success over a
 * ticket that is invisible here (or never written). We disable it instead.
 */
export function MyTickets({
  tickets,
  canRaise,
  blockedReason,
}: {
  tickets: TicketView[];
  canRaise: boolean;
  blockedReason: string;
}) {
  return (
    <div className="two-col">
      <div className="card">
        <div className="hd">
          <h3>My tickets</h3>
          <span className="folio">{tickets.length} total</span>
        </div>
        <div className="bd">
          {tickets.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {canRaise ? 'No tickets yet — raise one on the right.' : 'No tickets to show.'}
            </p>
          ) : (
            tickets.map((t) => (
              <div className="policy" key={t.id}>
                <div className="phd">
                  <h4>{t.subject}</h4>
                  {t.category && <span className="cat">{t.category}</span>}
                  <span className="ver">{formatDate(t.createdAt.slice(0, 10))}</span>
                  <span style={{ flex: 1 }} />
                  <span className="pill" style={statusPillStyle(t.status)}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </div>
                {t.body && <p className="body">{t.body}</p>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Raise a ticket</h3>
        </div>
        <div className="bd">
          {canRaise ? (
            <NewTicketForm />
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              {blockedReason}
            </p>
          )}
        </div>
      </div>
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
      if (res.ok) router.refresh();
      return res;
    },
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
          rows={4}
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
