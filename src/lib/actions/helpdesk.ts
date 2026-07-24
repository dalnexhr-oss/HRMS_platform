'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyApprovers, notifyEmployee } from '@/lib/notify';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** Raise a new support ticket (status defaults to 'open'). Employee-facing. */
export async function createTicket(formData: FormData) {
  const subject = String(formData.get('subject') ?? '').trim();
  if (!subject) return { ok: false, error: 'Subject is required.' };

  const db = requireDb('Raising a ticket');
  if (!db.ok) return db;

  const { profile } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase
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
  const supabase = await createClient();
  const resolved_at = status === 'resolved' || status === 'closed' ? new Date().toISOString() : null;

  // Only touch resolution_note when a reply is actually written, so a plain
  // status change keeps working even before migration 0018 is applied.
  const patch: Record<string, unknown> = { status, resolved_at };
  if (reply) patch.resolution_note = reply;

  const { data, error } = await supabase
    .from('helpdesk_tickets')
    .update(patch)
    .eq('id', id)
    .select('id, subject, employee_id');

  if (error) {
    if (error.code === '42703') {
      return { ok: false, error: 'Ticket replies aren’t set up on the database yet — apply the latest migration.' };
    }
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
    link: '/me',
  });

  revalidatePath('/helpdesk');
  revalidatePath('/me');
  return { ok: true };
}

/**
 * Post a follow-up comment on a ticket. Either side may post: staff on any
 * ticket, an employee on their own (enforced by RLS). When the employee owner
 * follows up on a resolved/closed ticket, it is REOPENED. The author name and
 * staff flag are stored on the comment so the thread renders without reading
 * another user's profile.
 */
export async function addTicketComment(ticketId: string, body: string) {
  const text = (body ?? '').trim();
  if (!text) return { ok: false, error: 'Write a message first.' };

  const db = requireDb('Posting a follow-up');
  if (!db.ok) return db;

  const { profile } = await getSession();
  if (!profile?.id) return { ok: false, error: 'You must be signed in to post a follow-up.' };
  const isStaff = profile.role != null && profile.role !== 'employee';

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('helpdesk_ticket_comments')
    .insert({
      ticket_id: ticketId,
      author_id: profile.id,
      author_name: profile.full_name ?? null,
      author_is_staff: isStaff,
      body: text,
    })
    .select('id');

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'Ticket follow-ups aren’t set up on the database yet — apply migration 0021.' };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The follow-up was not posted — your account may not have permission.' };
  }

  // Load the parent ticket once — for the reopen check and for notifying the
  // other party.
  const { data: ticket } = await supabase
    .from('helpdesk_tickets')
    .select('status, subject, employee_id')
    .eq('id', ticketId)
    .maybeSingle<{ status: TicketStatus; subject: string; employee_id: string | null }>();

  // An employee following up on a resolved/closed ticket reopens it.
  if (!isStaff && ticket && (ticket.status === 'resolved' || ticket.status === 'closed')) {
    await supabase
      .from('helpdesk_tickets')
      .update({ status: 'open', resolved_at: null })
      .eq('id', ticketId);
  }

  const subject = ticket?.subject ?? 'your ticket';
  if (isStaff) {
    await notifyEmployee(ticket?.employee_id ?? null, {
      kind: 'ticket',
      title: `New reply on your ticket: ${subject}`,
      body: text,
      link: '/me',
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
  return { ok: true };
}
