'use server';

// ============================================================================
// In-app e-signature (migration 0037 §4).
//
// A signature is only evidence if the signer controls neither WHEN nor FROM
// WHERE it was recorded. So:
//   * `signed_at` is NEVER sent from here — the column default (`now()`, the
//     transaction clock) fires, and the RLS insert policy independently rejects
//     anything outside ±5 minutes of `now()`. A crafted PostgREST call cannot
//     backdate a signature even if it bypasses this file entirely.
//   * `ip` / `user_agent` are read from the REQUEST headers server-side, never
//     accepted as arguments.
//   * The table is append-only: no UPDATE or DELETE policy exists for any role,
//     and staff may READ but never INSERT — a signature HR could forge proves
//     nothing.
//
// What the employee supplies is exactly one thing: their typed name.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, wroteNothing } from '@/lib/actions/_guard';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Document kinds that may be acknowledged. Free text in the DB; bounded here. */
const KINDS = ['policy', 'offer_letter', 'handbook', 'asset_declaration', 'fnf'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record the signed-in employee's acknowledgement of a document.
 *
 * `documentId` is optional — some acknowledgements (a handbook with no row of its
 * own) are free-standing. The unique index only applies when it is present, so a
 * genuinely re-issued document gets a new id and can be signed again.
 */
export async function acknowledgeDocument(input: {
  kind: string;
  documentId?: string | null;
  signedName: string;
}): Promise<ActionResult> {
  const db = requireDb('Signing an acknowledgement');
  if (!db.ok) return db;

  const kind = String(input.kind ?? '').trim();
  if (!(KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'Unknown document type.' };
  }

  const signedName = String(input.signedName ?? '').trim();
  if (signedName.length < 3) {
    return { ok: false, error: 'Type your full name to sign.' };
  }

  const documentId = input.documentId ? String(input.documentId).trim() : null;
  if (documentId && !UUID_RE.test(documentId)) {
    return { ok: false, error: 'That document reference is not valid.' };
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!employeeId) {
    return {
      ok: false,
      error: 'Your login is not linked to an employee record, so it cannot carry a signature. Ask HR to link it.',
    };
  }

  // A typed signature should be the signer's own name. Warn rather than block on
  // a mismatch — legal names and portal names differ often enough (initials,
  // married names) that refusing would be wrong more than it would be right.
  // Recorded either way; HR can see both fields.

  const h = await headers();
  // x-forwarded-for can carry a proxy chain; the column is text precisely so the
  // whole chain is preserved rather than lossily parsed to one address.
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null;
  const userAgent = h.get('user-agent') ?? null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('acknowledgements')
    .insert({
      employee_id: employeeId,
      document_kind: kind,
      document_id: documentId,
      signed_name: signedName,
      // signed_at intentionally OMITTED — see the file header.
      ip,
      user_agent: userAgent,
    })
    .select('id');

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'E-signatures are not set up on the database yet — apply migration 0037.' };
    }
    // The partial unique index: already signed.
    if (error.code === '23505') {
      return { ok: false, error: 'You have already signed this document.' };
    }
    // The ±5-minute window or the employee_id check refused it.
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'The signature was refused. Reload the page and try again — your session clock may be out of step.',
      };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The signature was not recorded — reload and try again.' };
  }

  revalidatePath('/me');
  return { ok: true };
}
