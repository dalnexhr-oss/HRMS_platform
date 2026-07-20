'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';

/**
 * Updates (or inserts) a settings row. The value is stored as jsonb — it is
 * passed through untouched, so numbers persist as numbers and time strings
 * ('HH:MM') persist as strings.
 */
export async function updateSetting(key: string, value: unknown) {
  const gate = await requireStaff('Changing a setting');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' })
    .select('key');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The setting was not saved — your account may not have permission.' };
  }
  revalidatePath('/settings');
  return { ok: true };
}
