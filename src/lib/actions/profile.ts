'use server';

// ============================================================================
// The signed-in user's own profile edits. Currently just the avatar.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { requireDb, wroteNothing } from '@/lib/actions/_guard';
import { isAvatarPresetId } from '@/lib/avatar-presets';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// A 128×128 JPEG at q≈0.82 is ~8–16 KB once base64-encoded; this cap (≈375 KB of
// base64) is generous headroom while still refusing a full-size photo.
const MAX_DATA_URL_LEN = 500_000;
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Set (or clear) the current user's avatar.
 *   null            → remove (fall back to initials)
 *   'preset:<id>'   → a bundled shadcn avatar image
 *   'data:image/…'  → a small, client-resized photo
 * Anything else is rejected.
 */
export async function updateAvatar(value: string | null): Promise<ActionResult> {
  const db = requireDb('Updating your picture');
  if (!db.ok) return db;

  // Validate the shape BEFORE touching the DB — never store an arbitrary string.
  if (value !== null) {
    if (value.startsWith('preset:')) {
      if (!isAvatarPresetId(value.slice('preset:'.length))) {
        return { ok: false, error: 'That avatar choice is not recognised.' };
      }
    } else if (value.startsWith('data:image/')) {
      if (value.length > MAX_DATA_URL_LEN) {
        return { ok: false, error: 'That image is too large. Please choose a smaller photo.' };
      }
      if (!DATA_URL_RE.test(value)) {
        return { ok: false, error: 'That file is not a supported image (use PNG, JPEG or WebP).' };
      }
    } else {
      return { ok: false, error: 'Unsupported picture value.' };
    }
  }

  const { userId } = await getSession();
  if (!userId) return { ok: false, error: 'You must be signed in to change your picture.' };

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('profiles')
    .update({ avatar: value })
    .eq('id', userId)
    .select('id');

  // The "avatar column is missing" branch is gone with Postgres: `avatar` is a
  // plain field on the user document, there is no column to be undefined, and
  // neither the 42703 code nor a "column ... does not exist" message can reach
  // here from the Mongo driver.
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Your picture was not saved — your account may lack permission.' };
  }

  // The avatar shows in the topbar on every screen, so refresh the whole layout.
  revalidatePath('/', 'layout');
  return { ok: true };
}
