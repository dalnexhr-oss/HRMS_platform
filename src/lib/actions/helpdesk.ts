'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';
import type { TicketComment } from '@/lib/queries';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** Raise a new support ticket (status defaults to 'open'). Employee-facing. */
export async function createTicket(formData: FormData) {
  const subject = String(formData.get('subject') ?? '').trim();
  if (!subject) return { ok: false, error: 'Subject is required.' };

  const db = requireDb('Raising a ticket');
  if (!db.ok) return db;

  const { profile } = await getSession();
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('helpdesk_tickets')
    .insert({
      subject,
      category: (formData.get('category') as string)?.trim() || null,
      body: String(formData.get('body') ?? '').trim() || null,
      status: 'open',
      employee_id: profile?.employee_id ?? null,
    })
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The ticket was not raised — your account may not have permission.' };
  }

  await notifyApprovers(
    {
      kind: 'ticket',
      title: `New helpdesk ticket: ${subject}`,
      body: profile?.full_name ? `Raised by ${profile.full_name}` : null,
      link: '/helpdesk',
    },
    profile?.id,
  );

  // '/helpdesk' is the staff queue; '/me' is the employee's own ticket list —
  // a ticket can be raised from either, so refresh both.
  revalidatePath('/helpdesk');
  revalidatePath('/me');
  return { ok: true };
}

/**
 * Change a ticket's status and, optionally, send a written reply. Staff-only.
 * Stamps resolved_at when it closes/resolves; the reply (when given) is stored on
 * the ticket and included in the employee's notification.
 */
export async function setTicketStatus(id: string, status: TicketStatus, note?: string) {
  const gate = await requireStaff('Updating a ticket');
  if (!gate.ok) return gate;

  const reply = (note ?? '').trim();
  const dbc = await createClient();
  const resolved_at = status === 'resolved' || status === 'closed' ? new Date() : null;

  // Only touch resolution_note when a reply is actually written, so a plain
  // status change does not blank out the note left with an earlier one.
  const patch: Record<string, unknown> = { status, resolved_at };
  if (reply) patch.resolution_note = reply;

  const { data, error } = await dbc
    .from('helpdesk_tickets')
    .update(patch)
    .eq('id', id)
    .select('id, subject, employee_id');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The ticket was not updated — it may no longer exist, or your role lacks permission.',
    };
  }

  const row = data![0] as { subject: string; employee_id: string | null };
  await notifyEmployee(row.employee_id, {
    kind: 'ticket',
    title: `Your ticket is now ${status.replace('_', ' ')}`,
    body: reply ? `${row.subject} — ${reply}` : row.subject,
    link: '/me#tickets',
  });

  revalidatePath('/helpdesk');
  revalidatePath('/me');
  return { ok: true };
}

/**
 * Post a follow-up comment on a ticket. Either side may post: staff on any
 * ticket, an employee on their own — enforced by the parent-ticket read below,
 * NOT by the collection's insert rule, which only checks that you are claiming
 * to be yourself. When the employee owner follows up on a resolved/closed
 * ticket, it is REOPENED. The author name and staff flag are stored on the
 * comment so the thread renders without reading another user's profile.
 */
export async function addTicketComment(ticketId: string, body: string) {
  const text = (body ?? '').trim();
  if (!text) return { ok: false, error: 'Write a message first.' };

  const db = requireDb('Posting a follow-up');
  if (!db.ok) return db;

  const { profile } = await getSession();
  if (!profile?.id) return { ok: false, error: 'You must be signed in to post a follow-up.' };
  const isStaff = profile.role != null && profile.role !== 'employee';

  const dbc = await createClient();

  // THE PARENT-TICKET CHECK — the authorisation for this action.
  //
  // The collection's insert rule only asks "is author_id you?", which every
  // caller trivially satisfies about themselves; it says nothing about WHICH
  // ticket. The SQL policy scoped the insert through the parent
  // (`exists (select 1 from helpdesk_tickets …)`) and policies.ts records that
  // the check belongs here — it just was not written. Without it, any
  // signed-in employee could post into a stranger's thread by supplying that
  // ticket's id, and both the ticket's owner and HR would see the message.
  //
  // Read through the caller's own scope, so an employee sees only their own
  // ticket and staff see any: the same rule that decides whether the thread is
  // visible decides whether it can be replied to.
  const { data: ticket, error: ticketError } = await dbc
    .from('helpdesk_tickets')
    .select('id, status, subject, employee_id')
    .eq('id', ticketId)
    .maybeSingle<{ status: TicketStatus; subject: string; employee_id: string | null }>();
  if (ticketError) return { ok: false, error: ticketError.message };
  if (!ticket) {
    // Deliberately the same answer for "no such ticket" and "not yours": the
    // difference would confirm that someone else's ticket id exists.
    return { ok: false, error: 'That ticket could not be found.' };
  }

  const { data, error } = await dbc
    .from('helpdesk_ticket_comments')
    .insert({
      ticket_id: ticketId,
      author_id: profile.id,
      author_name: profile.full_name ?? null,
      author_role: profile.role ?? null,
      author_is_staff: isStaff,
      body: text,
    })
    .select('id, ticket_id, author_id, author_name, author_role, author_is_staff, body, created_at');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The follow-up was not posted — your account may not have permission.' };
  }

  const inserted = data![0] as {
    id: string;
    ticket_id: string;
    author_id: string | null;
    author_name: string | null;
    author_role: string | null;
    author_is_staff: boolean;
    body: string;
    created_at: Date | string;
  };
  const comment: TicketComment = {
    id: inserted.id,
    ticketId: inserted.ticket_id,
    body: inserted.body,
    authorId: inserted.author_id,
    authorName: inserted.author_name,
    authorRole: inserted.author_role,
    authorIsStaff: !!inserted.author_is_staff,
    // created_at comes back as a BSON date; the drawer formats a string.
    createdAt:
      inserted.created_at instanceof Date
        ? inserted.created_at.toISOString()
        : String(inserted.created_at),
  };

  // The parent ticket was already loaded above, for the authorisation check —
  // it is reused here for the reopen decision and for notifying the other
  // party, rather than read a second time.
  //
  // An employee following up on a resolved/closed ticket reopens it. The result
  // IS inspected: a reopen that quietly matched nothing is indistinguishable to
  // the employee from one that worked — the comment is posted either way — and
  // it leaves the ticket closed with nobody alerted, which is precisely what
  // the inverted write policy used to do here.
  if (!isStaff && (ticket.status === 'resolved' || ticket.status === 'closed')) {
    const reopened = await dbc
      .from('helpdesk_tickets')
      .update({ status: 'open', resolved_at: null })
      .eq('id', ticketId)
      .select('id');
    if (reopened.error || wroteNothing(reopened.data)) {
      return {
        ok: false,
        error:
          reopened.error?.message ??
          'Your follow-up was posted, but the ticket could not be reopened. Please tell HR.',
      };
    }
  }

  const subject = ticket.subject ?? 'your ticket';
  if (isStaff) {
    await notifyEmployee(ticket.employee_id ?? null, {
      kind: 'ticket',
      title: `New reply on your ticket: ${subject}`,
      body: text,
      link: '/me#tickets',
    });
  } else {
    await notifyApprovers(
      {
        kind: 'ticket',
        title: `Follow-up on ticket: ${subject}`,
        body: profile.full_name ? `From ${profile.full_name}: ${text}` : text,
        link: '/helpdesk',
      },
      profile.id,
    );
  }

  revalidatePath('/helpdesk');
  revalidatePath('/me');
  return { ok: true, comment };
}
