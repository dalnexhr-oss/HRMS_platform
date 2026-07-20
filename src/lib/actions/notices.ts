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

/**
 * Publish a notice. Blank branch = all branches (branch_id null).
 * When the "publish" checkbox is on, published_at is stamped now (else null → draft).
 */
export async function createNotice(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const channelRaw = String(formData.get('channel') ?? 'app').trim();
  const branch = String(formData.get('branch') ?? '').trim();
  const publish = formData.get('publish') === 'on';

  if (!title) return { ok: false, error: 'Please enter a title.' };

  const channel: 'app' | 'whatsapp' | 'both' =
    channelRaw === 'whatsapp' || channelRaw === 'both' ? channelRaw : 'app';

  const gate = await requireStaff('Publishing a notice');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const branch_id = await resolveBranchId(supabase, branch);
  const { data, error } = await supabase
    .from('notices')
    .insert({
      title,
      body: body || null,
      channel,
      branch_id,
      published_at: publish ? new Date().toISOString() : null,
    })
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The notice was not saved — your account may not have permission.' };
  }

  revalidatePath('/notices');
  return { ok: true };
}

/** Delete a notice by id. */
export async function deleteNotice(id: string) {
  const gate = await requireStaff('Deleting a notice');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.from('notices').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The notice was not removed — it may already be gone, or your role lacks permission.',
    };
  }

  revalidatePath('/notices');
  return { ok: true };
}
