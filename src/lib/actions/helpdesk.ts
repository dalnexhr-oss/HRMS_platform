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
