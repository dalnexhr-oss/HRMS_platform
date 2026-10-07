// Stream files after getObject() checks the session and bucket/path permissions.
import { NextResponse } from 'next/server';
import { ApiError, apiErrorCodes } from '@/lib/api/errors';
import { apiRoute } from '@/lib/api/route-handler';
import { getObject, StorageAccessError } from '@/lib/db/gridfs-file-storage';
import type { StorageBucket } from '@/lib/db/gridfs-file-storage';

export const runtime = 'nodejs';
// Do not share cached responses between users; each file request requires an access check.
export const dynamic = 'force-dynamic';

const buckets: ReadonlySet<string> = new Set([
  'employee-documents',
  'reimbursement-receipts',
  'generated-documents',
  'notice-attachments',
]);

async function readFile(
  _req: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  const { bucket, path } = await params;
  if (!buckets.has(bucket)) {
    throw new ApiError(404, apiErrorCodes.notFound, 'Unknown bucket.');
  }

  // Next.js decodes route parameters automatically; avoid redundant decodeURIComponent to handle
  // literal '%' characters safely.
  const key = path.join('/');

  try {
    const file = await getObject(bucket as StorageBucket, key);
    if (!file) {
      throw new ApiError(404, apiErrorCodes.notFound, 'Not found.');
    }

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.contentType,
        // inline so a PDF opens in the viewer rather than downloading; the
        // filename is the last segment of the key.
        'content-disposition': `inline; filename="${key.split('/').pop() ?? 'file'}"`,
        // private: a shared cache must never hold a permission-checked body.
        'cache-control': 'private, no-store',
        // The stored content-type is derived from a server-side extension
        // whitelist (lib/file-storage.ts), never from the browser's claim — but
        // nosniff makes certain the browser does not second-guess it either.
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof StorageAccessError) {
      throw new ApiError(403, apiErrorCodes.forbidden, e.message);
    }
    // Rethrown as-is: the wrapper reports it without exposing storage details.
    throw e;
  }
}

const GET = apiRoute('GET /api/files', readFile);

export { GET };
