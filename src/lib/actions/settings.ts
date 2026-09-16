'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { requireRoles, wroteNothing } from '@/lib/actions/guards';

// Upsert a setting without coercing its value. Staff authorization protects payroll, scheduling,
// and reimbursement settings.
export async function updateSetting(key: string, value: unknown) {
  const gate = await requireRoles(['super_admin', 'admin', 'hr'], 'Changing a setting');
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' })
    .select('key');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The setting was not saved — your account may not have permission.',
    };
  }
  revalidatePath('/settings');
  return { ok: true };
}
