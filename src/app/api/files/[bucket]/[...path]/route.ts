// ============================================================================
// Serves a stored file. Replaces Supabase's signed-URL origin.
//
// The session is checked on EVERY request, which is the whole point: a signed
// URL carried its own authorisation, so a link copied out of the page stayed
// good until it expired. This link is inert for anyone not signed in, and
// ownership is re-verified against the caller's scope inside getObject().
// ============================================================================
import { NextResponse } from 'next/server';
import { getObject, StorageAccessError, type StorageBucket } from '@/lib/db/gridfs';

export const runtime = 'nodejs';
// Per-user and permission-checked: caching this anywhere shared would serve one
// employee's document to the next requester.
export const dynamic = 'force-dynamic';

const BUCKETS: ReadonlySet<string> = new Set([
  'employee-documents',
  'reimbursement-receipts',
  'generated-documents',
  'notice-attachments',
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  const { bucket, path } = await params;
  if (!BUCKETS.has(bucket)) {
    return NextResponse.json({ error: 'Unknown bucket.' }, { status: 404 });
  }

  // NOT decoded again. Next has already percent-decoded the route params, so a
  // second pass is both wrong and unsafe: objectUrl() encodes a stored
  // '50%off.pdf' to '50%25off.pdf', Next hands back '50%off.pdf', and
  // decodeURIComponent on that throws URIError "URI malformed". It threw from
  // ABOVE the try below, so the route 500'd instead of answering, and any
  // document whose original filename contained a '%' was simply unopenable.
  const key = path.join('/');

  try {
    const file = await getObject(bucket as StorageBucket, key);
    if (!file) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.contentType,
        // inline so a PDF opens in the viewer rather than downloading; the
        // filename is the last segment of the key.
        'content-disposition': `inline; filename="${key.split('/').pop() ?? 'file'}"`,
        // private: a shared cache must never hold a permission-checked body.
        'cache-control': 'private, no-store',
        // The stored content-type is derived from a server-side extension
        // whitelist (lib/storage.ts), never from the browser's claim — but
        // nosniff makes certain the browser does not second-guess it either.
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof StorageAccessError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 });
  }
}
