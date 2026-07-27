'use client';

// A real-time conversation window for one ticket. Used by both the staff
// helpdesk screen and the employee dashboard. Initial messages arrive as a prop
// (server-fetched); new ones stream in over Supabase Realtime (postgres_changes
// on helpdesk_ticket_comments, scoped to this ticket) — RLS is applied per
// socket, so an employee only ever receives their own tickets' messages.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AvatarInner } from '@/components/ui/Avatar';
import { addTicketComment, setTicketStatus } from '@/lib/actions/helpdesk';
import type { TicketComment, TicketView } from '@/lib/queries';

type ChatTicket = Pick<TicketView, 'id' | 'subject' | 'status' | 'employeeName' | 'employeeCode'>;
type TicketStatus = TicketView['status'];

/** 'admin' -> 'Admin', 'hr' -> 'HR', etc. — labels a chat message's author. */
function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'hr':
      return 'HR';
    case 'manager':
      return 'Manager';
    case 'viewer':
      return 'Viewer';
    case 'employee':
      return 'Employee';
    default:
      return '';
  }
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
const STATUS_OPTIONS: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

/** ISO timestamp -> '15 Jul, 10:30'. */
function stampTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Build a "row-mapped" comment from a Realtime payload.new row. */
function fromRow(r: any): TicketComment {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    body: r.body,
    authorId: r.author_id ?? null,
    authorName: r.author_name ?? null,
    authorRole: r.author_role ?? null,
    authorIsStaff: !!r.author_is_staff,
    createdAt: r.created_at,
  };
}

export function TicketChatDrawer({
  ticket,
  initialComments,
  selfId,
  isStaff,
  open,
  onClose,
}: {
  ticket: ChatTicket | null;
  initialComments: TicketComment[];
  selfId: string | null;
  isStaff: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<TicketComment[]>(initialComments);
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? 'open');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset when the drawer switches to a different ticket.
  useEffect(() => {
    setMessages(initialComments);
    setStatus(ticket?.status ?? 'open');
    setError(null);
    setBody('');
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to live inserts for this ticket while the drawer is open.
  useEffect(() => {
    if (!open || !ticket) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`ticket:${ticket.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'helpdesk_ticket_comments',
          filter: `ticket_id=eq.${ticket.id}`,
        },
        (payload) => {
          const c = fromRow(payload.new);
          setMessages((prev) => (prev.some((m) => m.id === c.id) ? prev : [...prev, c]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view pinned to the newest message.
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  function send() {
    const text = body.trim();
    if (!text || !ticket) return;
    setError(null);
    startTransition(async () => {
      const res = await addTicketComment(ticket.id, text);
      if (!res.ok) {
        setError(res.error ?? 'Could not send the message.');
        return;
      }
      setBody('');
      // Append immediately (deduped by id so the Realtime echo doesn't double it).
      const c = (res as { comment?: TicketComment }).comment;
      if (c) setMessages((prev) => (prev.some((m) => m.id === c.id) ? prev : [...prev, c]));
      router.refresh();
    });
  }

  function changeStatus(next: TicketStatus) {
    if (!ticket) return;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const res = await setTicketStatus(ticket.id, next);
      if (!res.ok) setError(res.error ?? 'Could not change the status.');
      else router.refresh();
    });
  }

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer chat-drawer${open ? ' on' : ''}`} aria-label="Ticket conversation">
        {ticket && (
          <>
            <div className="dhd">
              <div style={{ minWidth: 0 }}>
                <h3 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ticket.subject}
                </h3>
                <div className="muted" style={{ fontSize: 12 }}>
                  {ticket.employeeName
                    ? `${ticket.employeeName}${ticket.employeeCode ? ` · ${ticket.employeeCode}` : ''}`
                    : 'Conversation'}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              {isStaff && (
                <select
                  className="chat-status"
                  value={status}
                  disabled={pending}
                  onChange={(e) => changeStatus(e.target.value as TicketStatus)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn quiet" onClick={onClose}>
                ✕
              </button>
            </div>

            <div className="chat" ref={scrollRef}>
              {messages.length === 0 ? (
                <p className="chat-empty">No messages yet — start the conversation below.</p>
              ) : (
                messages.map((m) => {
                  const mine = !!selfId && m.authorId === selfId;
                  const role = roleLabel(m.authorRole);
                  const name = m.authorName ?? (m.authorIsStaff ? 'Support' : 'Employee');
                  return (
                    <div key={m.id} className={`chat-row${mine ? ' me' : ''}`}>
                      <span className="av chat-av">
                        <AvatarInner name={name} />
                      </span>
                      <div className="chat-col">
                        <div className="chat-meta">
                          {role && <span className="chat-role">{role}</span>}
                          <span>{mine ? 'You' : name}</span>
                          <span className="chat-time">{stampTime(m.createdAt)}</span>
                        </div>
                        <div className="chat-bubble">{m.body}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="chat-composer">
              {error && (
                <div className="login-error" style={{ fontSize: 12, flexBasis: '100%', marginBottom: 6 }}>
                  {error}
                </div>
              )}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
                rows={2}
                disabled={pending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button type="button" className="btn primary" onClick={send} disabled={pending || !body.trim()}>
                {pending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
