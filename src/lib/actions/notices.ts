'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyEveryone } from '@/lib/notify';
import { purgeExpiredNotices } from '@/lib/queries';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Employee marks a notice as read on their dashboard. Idempotent. */
export async function markNoticeRead(noticeId: string) {
  const db = requireDb('Marking a notice as read');
  if (!db.ok) return db;

  const { profile } = await getSession();
  if (!profile?.employee_id) return { ok: false, error: 'No employee linked to this account.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('notice_reads')
    .insert({ notice_id: noticeId, employee_id: profile.employee_id });

  // A duplicate (already read) is a benign unique-violation — detect by SQL code.
  if (error && error.code !== UNIQUE_VIOLATION) {
    // 42P01 = undefined_table: migration 0016 (notice_reads) isn't applied yet.
    if (error.code === '42P01') {
      return {
        ok: false,
        error: 'Notice read-tracking isn’t set up on the database yet — apply the latest migration.',
      };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath('/me');
  return { ok: true };
}

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

  // Only a PUBLISHED notice notifies anyone — a draft is not news yet.
  if (publish) {
    await notifyEveryone(
      {
        kind: 'notice',
        title: `New notice: ${title}`,
        body: body || null,
        link: '/me',
      },
      gate.profileId,
    );
  }

  // Opportunistic cleanup on write (best-effort; also covered daily by pg_cron).
  await purgeExpiredNotices();

  revalidatePath('/notices');
  revalidatePath('/me'); // employees see published notices on their dashboard
  return { ok: true };
}

/**
 * Publish or unpublish an existing notice. Publishing stamps published_at now
 * (and notifies everyone); unpublishing clears it back to a draft.
 */
export async function setNoticePublished(id: string, published: boolean) {
  const gate = await requireStaff(published ? 'Publishing a notice' : 'Unpublishing a notice');
  if (!gate.ok) return gate;

  const supabase = await createClient();

  if (published) {
    // Only a genuine draft -> published transition restamps published_at and
    // notifies. The `.is('published_at', null)` guard means re-clicking Publish
    // on an already-published notice is a benign no-op — it won't restart the
    // 30-day expiry clock or re-spam everyone.
    const { data, error } = await supabase
      .from('notices')
      .update({ published_at: new Date().toISOString() })
      .eq('id', id)
      .is('published_at', null)
      .select('id, title');
    if (error) return { ok: false, error: error.message };
    if (!wroteNothing(data)) {
      const title = (data as { title: string }[])[0]?.title ?? 'A notice';
      await notifyEveryone(
        { kind: 'notice', title: `New notice: ${title}`, body: null, link: '/me' },
        gate.profileId,
      );
    }
  } else {
    const { data, error } = await supabase
      .from('notices')
      .update({ published_at: null })
      .eq('id', id)
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (wroteNothing(data)) {
      return { ok: false, error: 'The notice was not updated — it may be gone, or your role lacks permission.' };
    }
  }

  revalidatePath('/notices');
  revalidatePath('/me');
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
  revalidatePath('/me');
  return { ok: true };
}
