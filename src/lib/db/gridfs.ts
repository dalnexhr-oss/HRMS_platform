// GridFS storage with employee-scoped paths: <employeeId>/<uuid>-<filename>. File routes recheck
// session and path access for each request.
import 'server-only';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GridFSBucket, ObjectId, type GridFSFile } from 'mongodb';
import { db } from '@/lib/db/mongo';
import { currentScope, type Scope } from '@/lib/db/scope';

export type StorageBucket =
  'employee-documents' | 'reimbursement-receipts' | 'generated-documents' | 'notice-attachments';

// Buckets partitioned by employee ID prefix. Unlisted buckets are company-wide (staff write,
// authenticated read).
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
  if (!scope) {
    throw new StorageAccessError('You are not signed in.');
  }
  return scope;
}

// Enforces read authorization: HR/admin can read all buckets; employees can only read within their
// own path prefix.
function assertMayRead(scope: Scope, bucket: StorageBucket, path: string): void {
  if (scope.isStaff) {
    return;
  }
  if (!employeeScoped.has(bucket)) {
    // company-wide: any signed-in reader
    return;
  }
  const owner = ownerOf(path);
  if (!owner || owner !== scope.employeeId) {
    throw new StorageAccessError();
  }
}

// Enforces upload authorization: privileged buckets (generated-documents, notice-attachments)
// require HR/admin.
function assertMayWrite(scope: Scope, bucket: StorageBucket, path: string): void {
  if (scope.isStaff) {
    return;
  }
  if (bucket === 'generated-documents' || bucket === 'notice-attachments') {
    throw new StorageAccessError('Only admin or HR can upload here.');
  }
  const owner = ownerOf(path);
  if (!owner || owner !== scope.employeeId) {
    throw new StorageAccessError();
  }
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
 * putObject accepts buffered bytes or a streaming source. Blob and ReadableStream inputs are
 * uploaded without buffering the full file.
 */
export type StorableBody = ArrayBuffer | Uint8Array | Blob | ReadableStream<Uint8Array>;

/**
 * Streams payload to GridFS at the specified bucket path.
 *
 * Consumes source streams directly chunk-by-chunk to avoid loading large files into memory.
 * Automatically cleans up partial chunks via stream abort upon pipeline failure.
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

  // Pipeline propagates errors bidirectionally; abort() cleans up partial chunks on failure.
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
  if (!file) {
    return null;
  }

  const fs = await gridfs(bucket);
  const chunks: Buffer[] = [];
  for await (const chunk of fs.openDownloadStream(file._id)) {
    chunks.push(chunk as Buffer);
  }

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

// Deletes all revisions matching the given path.
export async function deleteObject(
  bucket: StorageBucket,
  path: string,
  scope?: Scope,
): Promise<boolean> {
  const s = scope ?? (await requireScope());
  assertMayWrite(s, bucket, path);

  const fs = await gridfs(bucket);
  const files = await fs.find({ filename: path }).toArray();
  for (const f of files) {
    await fs.delete(f._id);
  }
  return files.length > 0;
}

// Generates the relative API route URL for streaming the target file with session authentication.
export function objectUrl(bucket: StorageBucket, path: string): string {
  return `/api/files/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
