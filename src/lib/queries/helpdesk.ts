import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail, iso } from '@/lib/queries/shared';
import { scoped, afterParentCheck } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';

/** One employee's helpdesk tickets, newest first. */
const ticketCols =
  'id, subject, body, category, status, created_at, resolution_note, employees(code, full_name)';

async function getMyTickets(employeeId: string): Promise<TicketView[]> {
  const queryClient = await createClient();
  const res = await queryClient
    .from('helpdesk_tickets')
    .select(ticketCols)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getMyTickets: could not load tickets', res.error);
  }
  return (res.data ?? []).map(mapTicket);
}

// helpdesk
interface TicketView {
  id: string;
  subject: string;
  body: string | null;
  category: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  employeeName: string | null;
  employeeCode: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

function mapTicket(t: any): TicketView {
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    category: t.category,
    status: t.status,
    employeeName: t.employees?.full_name ?? null,
    employeeCode: t.employees?.code ?? null,
    resolutionNote: t.resolution_note ?? null,
    createdAt: iso(t.created_at),
  };
}

/** Helpdesk tickets, open first then newest. */
async function getTickets(): Promise<TicketView[]> {
  const queryClient = await createClient();
  const res = await queryClient
    .from('helpdesk_tickets')
    .select(ticketCols)
    .order('created_at', { ascending: false });
  if (res.error) {
    fail('getTickets: could not load tickets', res.error);
  }
  // Open tickets first, otherwise preserve newest-first ordering.
  return (res.data ?? [])
    .map(mapTicket)
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
}

// helpdesk thread
interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  /** The author's role at post time ('admin' | 'hr' | … | 'employee'), for the label. */
  authorRole: string | null;
  /** Distinguishes a staff/HR follow-up from the employee's own, for the pill. */
  authorIsStaff: boolean;
  createdAt: string;
}

function mapComment(c: any): TicketComment {
  return {
    id: c.id,
    ticketId: c.ticket_id,
    body: c.body,
    authorId: c.author_id ?? null,
    authorName: c.author_name ?? null,
    authorRole: c.author_role ?? null,
    authorIsStaff: !!c.author_is_staff,
    // created_at is a BSON date, and TicketComment.createdAt is a string that
    // crosses into a client component — iso() is the one place that conversion
    // is decided.
    createdAt: iso(c.created_at),
  };
}

/**
 * Group ticket comments oldest first. Check parent-ticket ownership before reading; the comment
 * collection alone does not enforce thread access.
 */
async function getTicketComments(ticketIds: string[]): Promise<Record<string, TicketComment[]>> {
  if (ticketIds.length === 0) {
    return {};
  }

  // Filter by tickets the caller can access before reading comments. Scoping comments by author
  // would hide staff replies and would not establish ticket access.
  const tickets = await scoped<{ _id: string }>(collections.helpdeskTickets);
  const visible = await tickets.find({ _id: { $in: ticketIds } }, { projection: { _id: 1 } });
  const allowed = visible.map((t) => String(t._id));
  if (allowed.length === 0) {
    return {};
  }

  // Unscoped, because the rule above IS the collection's access rule and it has
  // just been applied. afterParentCheck() rather than systemCollection(): this
  // runs on a request, and the name says where to find the check.
  const comments = afterParentCheck<{ _id: string; ticket_id: string; created_at: Date }>(
    collections.helpdeskTicketComments,
  );
  const rows = await comments.find({ ticket_id: { $in: allowed } }, { sort: { created_at: 1 } });

  const byTicket: Record<string, TicketComment[]> = {};
  for (const row of rows) {
    const c = mapComment({ ...row, id: row._id });
    (byTicket[c.ticketId] ??= []).push(c);
  }
  return byTicket;
}

export { getMyTickets, getTickets, getTicketComments };

export type { TicketView, TicketComment };
