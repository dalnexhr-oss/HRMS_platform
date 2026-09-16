'use server';

// Recipients may only update their own notification read state. The collection policy supplies
// recipient scoping.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireDb } from '@/lib/actions/guards';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Mark one notification read. The write policy ensures it can only be your own.
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const db = requireDb('Marking a notification read');
  if (!db.ok) {
    return db;
  }
  if (!id) {
    return { ok: false, error: 'No notification selected.' };
  }

  const dbc = await createClient();
  const { error } = await dbc
    .from('notifications')
    .update({ read_at: new Date() })
    .eq('id', id)
    .is('read_at', null);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

// Mark every unread notification read.
export async function markAllNotificationsRead(): Promise<ActionResult> {
  const db = requireDb('Marking notifications read');
  if (!db.ok) {
    return db;
  }

  const dbc = await createClient();
  const { error } = await dbc
    .from('notifications')
    .update({ read_at: new Date() })
    .is('read_at', null);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
