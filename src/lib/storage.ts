// ============================================================================
// Supabase Storage helpers. SERVER ONLY (used from server actions).
//
// Buckets + RLS are defined in migration 0032. Objects are stored under
// `<employeeId>/<uuid>-<filename>` so the storage RLS folder check
// ((storage.foldername(name))[1] = current_employee_id()) resolves to the owner.
//
// Uploads/reads go through the REQUEST-scoped client (the one createClient()
// returns) so RLS is enforced — an employee can only write to their own folder.
// System-generated documents (relieving/F&F letters) are written with the
// service-role client via the *Service variants, because no employee is signed
// in when a cron/HR job produces them.
// ============================================================================
import type { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type StorageBucket =
  | 'employee-documents'
  | 'reimbursement-receipts'
  | 'generated-documents';

/** Strip path separators and odd characters from a user-supplied filename. */
function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
}

// ---------------------------------------------------------------------------
// Upload-type whitelist. The browser's file.type is attacker-controlled: an
// HTML file uploaded with type text/html would be SERVED as a rendered page
// from the signed URL (stored XSS on the storage origin, reachable by HR via
// the verification queue). So the stored contentType is derived from the file
// EXTENSION against this whitelist, and file.type is never trusted.
// ---------------------------------------------------------------------------
const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const UPLOAD_KIND_EXTS = {
  /** Certificates, ID proofs, offer letters… */
  document: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx'],
  /** Receipts are photos or PDFs. */
  receipt: ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
} as const;

export type UploadKind = keyof typeof UPLOAD_KIND_EXTS;

/**
 * Validate a user upload's filename against the whitelist for its kind and
 * return the contentType to store. Refuses unknown/missing extensions.
 */
export function resolveUploadType(
  filename: string,
  kind: UploadKind,
): { ok: true; contentType: string } | { ok: false; error: string } {
  const allowed = UPLOAD_KIND_EXTS[kind];
  const ext = (safeName(filename).split('.').pop() ?? '').toLowerCase();
  if (!(allowed as readonly string[]).includes(ext) || !EXTENSION_TYPES[ext]) {
    return {
      ok: false,
      error: `That file type is not accepted. Use one of: ${allowed.join(', ')}.`,
    };
  }
  return { ok: true, contentType: EXTENSION_TYPES[ext] };
}

/** `<employeeId>/<uuid>-<safe filename>` — the RLS-checked object key. */
export function objectPath(employeeId: string, filename: string): string {
  return `${employeeId}/${crypto.randomUUID()}-${safeName(filename)}`;
}

export interface UploadResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Upload bytes to a bucket under the employee's folder using the RLS-scoped
 * client. `body` is anything the Supabase JS upload accepts (File/Blob/
 * ArrayBuffer/Buffer). Returns the stored path (persist it on the owning row).
 */
export async function uploadFile(
  supabase: SupabaseServerClient,
  bucket: StorageBucket,
  employeeId: string,
  filename: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType?: string,
): Promise<UploadResult> {
  const path = objectPath(employeeId, filename);
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

/** Service-role upload for system-generated files (no signed-in user). */
export async function uploadFileService(
  bucket: StorageBucket,
  employeeId: string,
  filename: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType?: string,
): Promise<UploadResult> {
  const path = objectPath(employeeId, filename);
  const admin = createServiceClient();
  const { error } = await admin.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

/**
 * Mint a short-lived signed URL for a private object. RLS is enforced against
 * the passed client, so an employee only signs their own files. Default TTL is
 * 5 minutes — long enough to open, short enough not to leak.
 */
export async function signedUrl(
  supabase: SupabaseServerClient,
  bucket: StorageBucket,
  path: string,
  expiresInSec = 300,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSec);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not sign the file URL.' };
  return { ok: true, url: data.signedUrl };
}

/** Delete an object (staff cleanup / withdrawn claim). Best-effort, RLS-scoped. */
export async function removeFile(
  supabase: SupabaseServerClient,
  bucket: StorageBucket,
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  return error ? { ok: false, error: error.message } : { ok: true };
}
