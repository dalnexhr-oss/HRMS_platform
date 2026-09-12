//
// Streaming document upload.
//
// The counterpart to the Server Action in actions/documents.ts, and it exists
// for one reason: SIZE. An action receives FormData, which means Next buffers
// and decodes the entire multipart body before the action's first line runs —
// so a 10 MB scan is held whole in memory, nothing reaches mongod until the
// last byte has arrived, and the browser has no way to report progress because
// an action call exposes no upload events.
//
// Here the file IS the request body. It is piped into GridFS as it arrives, so
// storing overlaps receiving, only one chunk is resident at a time, and the
// client can drive a real progress bar off XMLHttpRequest.upload.
//
// The metadata travels in the query string rather than as form fields, because
// a multipart body would reintroduce exactly the buffering this avoids.
//
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isMongoConfigured } from '@/lib/db/mongo';
import { deleteObject, StorageAccessError } from '@/lib/db/gridfs';
import { resolveUploadType, uploadFile } from '@/lib/storage';
import {
  maxBytes,
  recordUploadedDocument,
  resolveTargetEmployee,
  uploadBucket,
} from '@/lib/documents/upload';

export const runtime = 'nodejs';
// The body is consumed as a stream and the work is per-user; nothing here is
// cacheable and a static render would have no request to read.
export const dynamic = 'force-dynamic';

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Stop a body that runs past the cap, mid-flight.
 *
 * Content-Length is checked first because it is far cheaper to refuse before
 * reading anything — but it is a CLAIM, sent by the client, and a chunked
 * request need not send one at all. So the count is enforced again over the
 * real bytes, which is what actually bounds what can be written.
 */
function capped(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          // Errors the stream, which aborts the GridFS write and removes the
          // chunks already stored (see putObject).
          controller.error(new Error('too-large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export async function POST(req: Request) {
  if (!isMongoConfigured()) {
    return bad('The database is not configured, so the document was not filed.', 503);
  }

  const { profile } = await getSession();
  if (!profile) return bad('Your session has expired. Sign in again.', 401);

  const params = new URL(req.url).searchParams;
  const filename = (params.get('filename') ?? '').trim();
  if (!filename) return bad('The file name is missing.');

  // Extension whitelist, exactly as the action applies it: the stored
  // content-type is derived from the name, never from what the client claims.
  const fileType = resolveUploadType(filename, 'document');
  if (!fileType.ok) return bad(fileType.error);

  // The cheap refusal: reject an oversize upload before reading its body
  // rather than after. ABSENT is not the same as zero — a chunked request
  // sends no Content-Length at all, and reading the missing header as 0 would
  // refuse it as an empty file. An unstated length just means the cap has to
  // be enforced over the bytes instead, which capped() does regardless.
  const header = req.headers.get('content-length');
  const declared = header === null ? null : Number(header);
  if (declared !== null && Number.isFinite(declared)) {
    if (declared > maxBytes) return bad('Documents must be 10 MB or smaller.', 413);
    if (declared === 0) return bad('Choose a file to upload.');
  }

  const target = resolveTargetEmployee(
    {
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name ?? null,
      employeeId: profile.employee_id ?? null,
    },
    (params.get('employee_id') ?? '').trim(),
  );
  if (!target.ok) return bad(target.error, 403);

  if (!req.body) return bad('Choose a file to upload.');

  let stored;
  try {
    stored = await uploadFile(
      uploadBucket,
      target.employeeId,
      filename,
      capped(req.body, maxBytes),
      fileType.contentType,
    );
  } catch (e) {
    if (e instanceof StorageAccessError) return bad(e.message, 403);
    if (e instanceof Error && e.message.includes('too-large')) {
      return bad('Documents must be 10 MB or smaller.', 413);
    }
    return bad(e instanceof Error ? e.message : 'The document could not be uploaded.', 500);
  }
  if (!stored.ok || !stored.path) {
    return bad(stored.error ?? 'The document could not be uploaded.', 500);
  }
  // A body that turned out to be empty — possible only when no Content-Length
  // was declared. No register row for it: an entry pointing at nothing reads as
  // a filed document and would satisfy a "missing paperwork" check. The empty
  // files document goes too, so nothing is left for a later read to find.
  if (stored.size === 0) {
    await deleteObject(uploadBucket, stored.path).catch(() => undefined);
    return bad('Choose a file to upload.');
  }

  const category = (params.get('category') ?? '').trim() || 'other';
  const title = (params.get('title') ?? '').trim() || filename;

  const recorded = await recordUploadedDocument({
    filer: {
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name ?? null,
      employeeId: profile.employee_id ?? null,
    },
    employeeId: target.employeeId,
    isStaff: target.isStaff,
    category,
    title,
    storagePath: stored.path,
  });
  if (!recorded.ok) return bad(recorded.error ?? 'The document was not filed.', 500);

  return NextResponse.json({ ok: true });
}
