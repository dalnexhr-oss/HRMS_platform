'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';

/** Resolve a branch name to its id, or null for "all branches". */
async function resolveBranchId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  branch: string,
): Promise<string | null> {
  const name = branch.trim();
  if (!name) return null;
  const { data } = await supabase.from('branches').select('id').eq('name', name).maybeSingle();
  return data?.id ?? null;
}

/** Add an official holiday. Blank branch = all branches (branch_id null). */
export async function addHoliday(formData: FormData) {
  const holiday_date = String(formData.get('holiday_date') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const branch = String(formData.get('branch') ?? '').trim();

  if (!holiday_date) return { ok: false, error: 'Please choose a date.' };
  if (!name) return { ok: false, error: 'Please enter a holiday name.' };

  const gate = await requireStaff('Adding a holiday');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const branch_id = await resolveBranchId(supabase, branch);
  const { data, error } = await supabase
    .from('holidays')
    .insert({ holiday_date, name, branch_id })
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The holiday was not added — your account may not have permission.' };
  }

  revalidatePath('/holidays');
  return { ok: true };
}

/** Delete a holiday by id. */
export async function deleteHoliday(id: string) {
  const gate = await requireStaff('Deleting a holiday');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.from('holidays').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The holiday was not removed — it may already be gone, or your role lacks permission.',
    };
  }

  revalidatePath('/holidays');
  return { ok: true };
}
