//
// File storage on GridFS. SERVER ONLY — replaces Supabase Storage.
//
// Four buckets became four GridFS bucket names in the same database, so files
// live in the same backup and the same connection string as everything else.
// For this application's volumes that is the right trade: no second service to
// configure, no second set of credentials, no CORS.
//
// WHAT REPLACED THE RLS THAT GUARDED THE BUCKETS
//
// Supabase enforced ownership on the object KEY — a policy compared
// `(storage.foldername(name))[1]` to current_employee_id(), so an employee
// could only touch `<their-id>/…`. Nothing enforces that now, so the same rule
// is applied here in assertMayRead/assertMayWrite, against the caller's scope.
//
// Object keys keep the identical `<employeeId>/<uuid>-<filename>` shape. That
// is not cosmetic: every existing row that stores a path — employee_documents,
// reimbursement receipts, notice attachments — keeps working unchanged.
//
// THERE ARE NO SIGNED URLS. Supabase minted a URL that carried its own
// authorisation, which meant a leaked link was a leaked file until it expired.
// Files are now streamed by a Route Handler that checks the session on every
// request, so a copied link is worthless to anyone not signed in.
//
import 'server-only';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {GridFSBucket, ObjectId, type GridFSFile} from 'mongodb';
import {db} from '@/lib/db/mongo';
import {currentScope, type Scope} from '@/lib/db/scope';

export type StorageBucket =
  | 'employee-documents'
  | 'reimbursement-receipts'
  | 'generated-documents'
  | 'notice-attachments';

// Buckets whose objects belong to one employee, keyed by the folder prefix. The rest are company-wide: staff write, everyone signed in may read.
const employeeScoped: ReadonlySet<StorageBucket> = new Set([
  'employee-documents',
  'reimbursement-receipts',
  'generated-documents',
]);

// GridFS names its collections `<bucket>.files` / `<bucket>.chunks`.
function bucketName(bucket: StorageBucket): string {
  return bucket.replace(/-/g, '_');
}
const chunkSizeBytes = 4 * 1024 * 1024;

async function gridfs(bucket: StorageBucket): Promise<GridFSBucket> {
  return new GridFSBucket(await db(), { bucketName: bucketName(bucket), chunkSizeBytes });
}

// The employee id a key belongs to: the first path segment.
function ownerOf(path: string): string | null {
  const first = path.split('/')[0];
  return first && first !== path ? first : null;
}

export class StorageAccessError extends Error {
  readonly userFacing = true;
  constructor(message = 'You do not have access to that file.') {
    super(message);
    this.name = 'StorageAccessError';
  }
}

async function requireScope(): Promise<Scope> {
  const scope = await currentScope();
  if (!scope) throw new StorageAccessError('You are not signed in.');
  return scope;
}

// The read rule for a stored file, per bucket. Staff read anything. An employee reads only what sits under their own folder, and only in the buckets that are folder-scoped at all.
function assertMayRead(scope: Scope, bucket: StorageBucket, path: string): void {
  if (scope.isStaff) return;
  if (!employeeScoped.has(bucket)) return; // company-wide: any signed-in reader
  const owner = ownerOf(path);
  if (!owner || owner !== scope.employeeId) throw new StorageAccessError();
}

// The write rule. Stricter than reading on purpose: generated-documents holds relieving letters and F&F statements, which the employee they concern must never be able to write. They may read their own; only staff and system jobs create them.
function assertMayWrite(scope: Scope, bucket: StorageBucket, path: string): void {
  if (scope.isStaff) return;
  if (bucket === 'generated-documents' || bucket === 'notice-attachments') {
    throw new StorageAccessError('Only admin or HR can upload here.');
  }
  const owner = ownerOf(path);
  if (!owner || owner !== scope.employeeId) throw new StorageAccessError();
}

export interface StoredFile {
  id: string;
  path: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
}

function toStored(f: GridFSFile): StoredFile {
  return {
    id: String(f._id),
    path: f.filename,
    contentType: (f.metadata?.contentType as string) ?? 'application/octet-stream',
    size: f.length,
    uploadedAt: f.uploadDate,
  };
}

async function findFile(bucket: StorageBucket, path: string): Promise<GridFSFile | null> {
  const fs = await gridfs(bucket);
  // Newest first: re-uploading the same key keeps the old revision rather than
  // destroying it, and reads resolve to the current one.
  const [file] = await fs.find({ filename: path }).sort({ uploadDate: -1 }).limit(1).toArray();
  return file ?? null;
}

/**
 * What `putObject` will store: bytes already in hand, or something that can
 * produce them a piece at a time.
 *
 * A Blob (which a `File` from a form is) and a ReadableStream are STREAMED —
 * see below for why that matters on anything the size of a scan.
 */
export type StorableBody = ArrayBuffer | Uint8Array | Blob | ReadableStream<Uint8Array>;

/**
 * Store bytes at `path`. The caller must already have built a scoped key.
 *
 * A Blob or a stream is piped rather than materialised. The old form called
 * `.arrayBuffer()` and then `Buffer.from()` on the result, so filing a 10 MB
 * document held THREE copies of it at once — the Blob's own bytes, the
 * ArrayBuffer, and the Buffer copy — before the first byte reached mongod.
 * Piping holds one chunk at a time and starts writing immediately, which is
 * also what lets an upload route overlap storing with receiving.
 *
 * `size` is reported from what was actually written, not from what the caller
 * claimed, so a stream whose length is not known up front is still accurate.
 */
export async function putObject(
  bucket: StorageBucket,
  path: string,
  body: StorableBody,
  contentType = 'application/octet-stream',
  scope?: Scope,
): Promise<StoredFile> {
  const s = scope ?? (await requireScope());
  assertMayWrite(s, bucket, path);

  const fs = await gridfs(bucket);
  const upload = fs.openUploadStream(path, {
    metadata: { contentType, uploadedBy: s.userId, employeeId: ownerOf(path) },
  });

  const source =
    body instanceof Blob
      ? Readable.fromWeb(body.stream() as Parameters<typeof Readable.fromWeb>[0])
      : body instanceof ReadableStream
        ? Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
        : Readable.from([Buffer.from(body as ArrayBuffer)]);

  // pipeline, not .pipe(): it propagates an error in EITHER direction and
  // destroys the other end, so a source that fails midway cannot leave the
  // GridFS stream hanging open.
  //
  // abort() on failure is the other half. Destroying the stream stops it; only
  // abort() removes the chunks already written, and without it a connection
  // dropped mid-upload would leave megabytes in <bucket>.chunks that no files
  // document points at and nothing ever collects.
  try {
    await pipeline(source, upload);
  } catch (e) {
    await upload.abort().catch(() => undefined);
    throw e;
  }

  return {
    id: String(upload.id as ObjectId),
    path,
    contentType,
    size: upload.length,
    uploadedAt: new Date(),
  };
}

// Read a whole object. Used by the PDF pipeline and the download route.
export async function getObject(
  bucket: StorageBucket,
  path: string,
  scope?: Scope,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const s = scope ?? (await requireScope());
  assertMayRead(s, bucket, path);

  const file = await findFile(bucket, path);
  if (!file) return null;

  const fs = await gridfs(bucket);
  const chunks: Buffer[] = [];
  for await (const chunk of fs.openDownloadStream(file._id)) chunks.push(chunk as Buffer);

  return {
    bytes: Buffer.concat(chunks),
    contentType: (file.metadata?.contentType as string) ?? 'application/octet-stream',
  };
}

// Metadata without transferring the bytes.
export async function statObject(
  bucket: StorageBucket,
  path: string,
  scope?: Scope,
): Promise<StoredFile | null> {
  const s = scope ?? (await requireScope());
  assertMayRead(s, bucket, path);
  const file = await findFile(bucket, path);
  return file ? toStored(file) : null;
}

// Remove every revision at `path`. Best-effort, like the old bucket remove.
export async function deleteObject(
  bucket: StorageBucket,
  path: string,
  scope?: Scope,
): Promise<boolean> {
  const s = scope ?? (await requireScope());
  assertMayWrite(s, bucket, path);

  const fs = await gridfs(bucket);
  const files = await fs.find({ filename: path }).toArray();
  for (const f of files) await fs.delete(f._id);
  return files.length > 0;
}

// The URL that serves a file. Replaces createSignedUrl. It carries no credential and never expires, because it is not the thing being trusted — the route checks the session on every request. A link copied out of the page is inert for anyone else.
export function objectUrl(bucket: StorageBucket, path: string): string {
  return `/api/files/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
