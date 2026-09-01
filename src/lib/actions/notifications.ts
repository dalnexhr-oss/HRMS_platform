'use server';

// ============================================================================
// Notification read-state. Marking read is the ONLY mutation a recipient may
// perform, and the notifications policy scopes it to `recipient_id` = the
// caller — so these actions never take a recipient id from the caller.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireDb } from '@/lib/actions/_guard';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Mark one notification read. The write policy ensures it can only be your own. */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const db = requireDb('Marking a notification read');
  if (!db.ok) return db;
  if (!id) return { ok: false, error: 'No notification selected.' };

  const dbc = await createClient();
  const { error } = await dbc
    .from('notifications')
    .update({ read_at: new Date() })
    .eq('id', id)
    .is('read_at', null);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Mark every unread notification read. */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  const db = requireDb('Marking notifications read');
  if (!db.ok) return db;

  const dbc = await createClient();
  const { error } = await dbc
    .from('notifications')
    .update({ read_at: new Date() })
    .is('read_at', null);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true };
}
