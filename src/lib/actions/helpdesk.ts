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

  revalidatePath('/helpdesk');
  return { ok: true };
}

/** Change a ticket's status; stamp resolved_at when it closes/resolves. Staff-only. */
export async function setTicketStatus(id: string, status: TicketStatus) {
  const gate = await requireStaff('Changing a ticket status');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const resolved_at = status === 'resolved' || status === 'closed' ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from('helpdesk_tickets')
    .update({ status, resolved_at })
    .eq('id', id)
    .select('id, subject, employee_id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The ticket status was not changed — it may no longer exist, or your role lacks permission.',
    };
  }

  const row = data![0] as { subject: string; employee_id: string | null };
  await notifyEmployee(row.employee_id, {
    kind: 'ticket',
    title: `Your ticket is now ${status.replace('_', ' ')}`,
    body: row.subject,
    link: '/me',
  });

  revalidatePath('/helpdesk');
  return { ok: true };
}
