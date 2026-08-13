'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyEveryone } from '@/lib/notify';
import { purgeExpiredNotices } from '@/lib/queries';
import { uploadSharedFile, signedUrl } from '@/lib/storage';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Notice attachments are PDFs only, capped like employee documents. */
const PDF_MAX_BYTES = 10 * 1024 * 1024;

type PdfParse =
  | { ok: true; file: File | null } // null = no file chosen
  | { ok: false; error: string };

/** The optional `pdf` form field: absent/empty is fine; anything non-PDF is not. */
function pdfField(formData: FormData): PdfParse {
  const file = formData.get('pdf');
  if (!(file instanceof File) || file.size === 0) return { ok: true, file: null };
  if (!/\.pdf$/i.test(file.name)) {
    return { ok: false, error: 'Notice attachments must be PDF files.' };
  }
  if (file.size > PDF_MAX_BYTES) {
    return { ok: false, error: 'The PDF must be 10 MB or smaller.' };
  }
  return { ok: true, file };
}

/** Upload a notice PDF and return its storage path. */
async function uploadNoticePdf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const up = await uploadSharedFile(
    supabase,
    'notice-attachments',
    'notices',
    file.name,
    await file.arrayBuffer(),
    'application/pdf',
  );
  if (!up.ok || !up.path) {
    // "Bucket not found" = migration 0042 hasn't been applied yet.
    const reason = up.error ?? 'unknown error';
    return {
      ok: false,
      error: /bucket/i.test(reason)
        ? 'The notice-attachments bucket is missing — apply migration 0042, then try again.'
        : `The PDF could not be uploaded: ${reason}`,
    };
  }
  return { ok: true, path: up.path };
}

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

  const pdf = pdfField(formData);
  if (!pdf.ok) return pdf;

  const gate = await requireStaff('Publishing a notice');
  if (!gate.ok) return gate;

  const supabase = await createClient();

  // Upload before the insert so a failed upload never leaves a notice whose
  // promised attachment does not exist.
  let pdfPath: string | null = null;
  if (pdf.file) {
    const up = await uploadNoticePdf(supabase, pdf.file);
    if (!up.ok) return up;
    pdfPath = up.path;
  }

  const branch_id = await resolveBranchId(supabase, branch);
  const { data, error } = await supabase
    .from('notices')
    .insert({
      title,
      body: body || null,
      channel,
      branch_id,
      pdf_url: pdfPath,
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
        link: '/me#notices',
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

/** Edit an existing notice's content (title/body/channel/branch/PDF). Staff-only.
 *  Does not change its published state — that's the Publish/Unpublish toggle.
 *  A newly chosen PDF replaces the old one; the "remove_pdf" checkbox clears it. */
export async function updateNotice(id: string, formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const channelRaw = String(formData.get('channel') ?? 'app').trim();
  const branch = String(formData.get('branch') ?? '').trim();
  const removePdf = formData.get('remove_pdf') === 'on';
  if (!title) return { ok: false, error: 'Please enter a title.' };

  const channel: 'app' | 'whatsapp' | 'both' =
    channelRaw === 'whatsapp' || channelRaw === 'both' ? channelRaw : 'app';

  const pdf = pdfField(formData);
  if (!pdf.ok) return pdf;

  const gate = await requireStaff('Editing a notice');
  if (!gate.ok) return gate;

  const supabase = await createClient();

  // Only touch pdf_url when the user acted: a fresh file replaces, the remove
  // checkbox clears, otherwise the existing attachment is left alone. The old
  // object is deliberately left in storage (same rule as employee documents):
  // the bucket is private and orphans are harmless.
  const patch: Record<string, unknown> = { title, body: body || null, channel };
  if (pdf.file) {
    const up = await uploadNoticePdf(supabase, pdf.file);
    if (!up.ok) return up;
    patch.pdf_url = up.path;
  } else if (removePdf) {
    patch.pdf_url = null;
  }

  const branch_id = await resolveBranchId(supabase, branch);
  patch.branch_id = branch_id;
  const { data, error } = await supabase
    .from('notices')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The notice was not updated — it may be gone, or your role lacks permission.' };
  }

  revalidatePath('/notices');
  revalidatePath('/me');
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
        { kind: 'notice', title: `New notice: ${title}`, body: null, link: '/me#notices' },
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

/**
 * Mint a short-lived signed URL for a notice's PDF. Open to every signed-in
 * user — a published notice is company-wide, and the storage read policy
 * (0042) grants the same audience.
 */
export async function getNoticePdfUrl(
  id: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const db = requireDb('Opening a notice PDF');
  if (!db.ok) return db;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notices')
    .select('pdf_url')
    .eq('id', id)
    .maybeSingle<{ pdf_url: string | null }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.pdf_url) return { ok: false, error: 'This notice has no PDF attached.' };

  const signed = await signedUrl(supabase, 'notice-attachments', data.pdf_url);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
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
