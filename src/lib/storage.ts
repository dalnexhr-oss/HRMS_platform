// Server-side file helpers. Preserve bucket names and <employeeId>/<uuid>-<filename> keys so stored
// paths remain valid. GridFS checks path access against the caller's session scope.
import {
  objectUrl,
  putObject,
  statObject,
  type StorableBody,
  type StorageBucket as GridBucket,
} from '@/lib/db/gridfs';
import { systemScope } from '@/lib/db/scope';

export type StorageBucket = GridBucket;
export type { StorableBody };

// Strip path separators and odd characters from a user-supplied filename.
function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
}

// Derive stored content types from the extension allowlist. Do not trust file.type, which could
// cause uploaded HTML to be served as an executable page.
const extensionTypes: Record<string, string> = {
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

const uploadKindExits = {
  // Certificates, ID proofs, offer letters…
  document: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx'],
  // Receipts are photos or PDFs.
  receipt: ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
} as const;

export type UploadKind = keyof typeof uploadKindExits;

// Validate a user upload's filename against the whitelist for its kind and return the contentType
// to store. Refuses unknown/missing extensions.
export function resolveUploadType(
  filename: string,
  kind: UploadKind,
): { ok: true; contentType: string } | { ok: false; error: string } {
  const allowed = uploadKindExits[kind];
  const ext = (safeName(filename).split('.').pop() ?? '').toLowerCase();
  if (!(allowed as readonly string[]).includes(ext) || !extensionTypes[ext]) {
    return {
      ok: false,
      error: `That file type is not accepted. Use one of: ${allowed.join(', ')}.`,
    };
  }
  return { ok: true, contentType: extensionTypes[ext] };
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
  // Bytes actually written. Worth reporting because a streamed body has no
  // length until it ends — the upload route has no Content-Length to trust when
  // the request is chunked, and this is how it finds out what it really stored.
  size?: number;
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
  // A File/Blob or a stream is piped straight through — see putObject. Pass the
  // File itself rather than `await file.arrayBuffer()`: buffering it first
  // undoes the streaming and holds the whole upload in memory.
  body: StorableBody,
  contentType?: string,
): Promise<UploadResult> {
  const path = objectPath(employeeId, filename);
  try {
    const stored = await putObject(bucket, path, body, contentType);
    return { ok: true, path, size: stored.size };
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
  // A File/Blob or a stream is piped straight through — see putObject. Pass the
  // File itself rather than `await file.arrayBuffer()`: buffering it first
  // undoes the streaming and holds the whole upload in memory.
  body: StorableBody,
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
 * Upload generated documents under system scope. Employees must not be able to author files in
 * generated-documents.
 */
export async function uploadFileService(
  bucket: StorageBucket,
  employeeId: string,
  filename: string,
  // A File/Blob or a stream is piped straight through — see putObject. Pass the
  // File itself rather than `await file.arrayBuffer()`: buffering it first
  // undoes the streaming and holds the whole upload in memory.
  body: StorableBody,
  contentType?: string,
): Promise<UploadResult> {
  const path = objectPath(employeeId, filename);
  try {
    await putObject(bucket, path, body, contentType, systemScope);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' };
  }
}

/**
 * Return the authenticated app URL for a private object after checking ownership. The URL carries
 * no credentials; the file route rechecks access on every request.
 */
export async function signedUrl(
  bucket: StorageBucket,
  path: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    // Use statObject for authorization and existence checks without reading every GridFS chunk
    // into memory.
    const file = await statObject(bucket, path);
    if (!file) {
      return { ok: false, error: 'That file is no longer stored.' };
    }
    return { ok: true, url: objectUrl(bucket, path) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not open the file.' };
  }
}
