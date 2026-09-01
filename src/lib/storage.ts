// ============================================================================
// File storage helpers. SERVER ONLY (used from server actions).
//
// The bucket names and the `<employeeId>/<uuid>-<filename>` key shape are
// unchanged, so every path already stored in the database still resolves. What
// moved is the enforcement: the folder prefix used to be checked by a storage
// policy in the database, and lib/db/gridfs.ts now checks it against the
// caller's scope instead. Nothing here takes a client — who is asking comes
// from the session.
//
// The upload-type whitelist below is the interesting part of this file.
// ============================================================================
import {
  objectUrl,
  putObject,
  statObject,
  type StorageBucket as GridBucket,
} from '@/lib/db/gridfs';
import { SYSTEM_SCOPE } from '@/lib/db/scope';

export type StorageBucket = GridBucket;

/** Strip path separators and odd characters from a user-supplied filename. */
function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
}

// ---------------------------------------------------------------------------
// Upload-type whitelist. The browser's file.type is attacker-controlled: an
// HTML file uploaded with type text/html would be SERVED as a rendered page
// from the file URL (stored XSS on the storage origin, reachable by HR via
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

/**
 * `<employeeId>/<uuid>-<safe filename>`.
 *
 * The leading folder is not decoration: gridfs.ts reads the employee id back
 * out of the key to decide who may open the object.
 */
function objectPath(employeeId: string, filename: string): string {
  return `${employeeId}/${crypto.randomUUID()}-${safeName(filename)}`;
}

export interface UploadResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Upload bytes to a bucket under the employee's own folder. Returns the stored
 * path — persist it on the owning row.
 */
export async function uploadFile(
  bucket: StorageBucket,
  employeeId: string,
  filename: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType?: string,
): Promise<UploadResult> {
  const path = objectPath(employeeId, filename);
  try {
    await putObject(bucket, path, body, contentType);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' };
  }
}

/**
 * Upload under a fixed shared folder rather than an employee's own — used for
 * company-wide files (notice attachments), where the rule is staff-write /
 * everyone-read instead of folder-scoped.
 */
export async function uploadSharedFile(
  bucket: StorageBucket,
  folder: string,
  filename: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType?: string,
): Promise<UploadResult> {
  const path = `${folder}/${crypto.randomUUID()}-${safeName(filename)}`;
  try {
    await putObject(bucket, path, body, contentType);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' };
  }
}

/**
 * System upload for generated files, where no employee is signed in.
 *
 * Runs under SYSTEM_SCOPE — the equivalent of the old service-role key, and the
 * only way to write into generated-documents, which the employee it concerns
 * must never be able to author.
 */
export async function uploadFileService(
  bucket: StorageBucket,
  employeeId: string,
  filename: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType?: string,
): Promise<UploadResult> {
  const path = objectPath(employeeId, filename);
  try {
    await putObject(bucket, path, body, contentType, SYSTEM_SCOPE);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' };
  }
}

/**
 * The URL that serves a private object.
 *
 * The name is kept because ~7 call sites use it, but nothing is signed any
 * more. A signed URL carried its own authorisation, so a leaked link was a
 * leaked file for the lifetime of the token. This returns a plain app path;
 * /api/files/... re-checks the session on every request, which makes a copied
 * link useless to anyone else and removes the expiry question entirely.
 *
 * Ownership is verified here too, so a caller that cannot read the file gets an
 * error at the point of asking rather than a URL that will 403 later.
 */
export async function signedUrl(
  bucket: StorageBucket,
  path: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    // statObject, not getObject: both run the same assertMayRead check and the
    // same existence lookup, but getObject concatenates every GridFS chunk into
    // a Buffer that is then thrown away. A document list resolving N URLs was
    // pulling N whole PDFs through the server on each render.
    const file = await statObject(bucket, path);
    if (!file) return { ok: false, error: 'That file is no longer stored.' };
    return { ok: true, url: objectUrl(bucket, path) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not open the file.' };
  }
}
