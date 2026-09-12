//
// Filing an employee document — the parts shared by the two ways in. SERVER ONLY.
//
// There are two entry points because they solve different problems:
//
//   actions/documents.uploadEmployeeDocument   a Server Action taking FormData.
//       Used by the staff drawers, where the file is small and the action's
//       automatic revalidation is exactly what is wanted.
//
//   app/api/documents/upload/route.ts          a streaming Route Handler.
//       Used by the employee's own locker, where a phone camera scan runs to
//       several megabytes. It writes the body into GridFS AS IT ARRIVES rather
//       than buffering the whole upload first, and because it is a plain HTTP
//       request the browser can report progress against it — a Server Action
//       gives no hook for that, so a large upload looked frozen.
//
// NOT a 'use server' module: every export there becomes a public endpoint, and
// these are internal helpers that already-authenticated callers compose.
//
import 'server-only';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { wroteNothing } from '@/lib/actions/_guard';
import { notifyApprovers } from '@/lib/notify';
import type { StorageBucket } from '@/lib/storage';
import type { AppRole } from '@/types/database';

/** Roles that may file against somebody else's record, and verify. */
export const verifyRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// Where UPLOADS go. Reads must not assume it — HR-issued letters live in
// generated-documents and the row's `bucket` column says which is which.
export const uploadBucket: StorageBucket = 'employee-documents';

/** Largest document accepted, in bytes. 10 MB — certificates scan large. */
export const maxBytes = 10 * 1024 * 1024;

export interface Filer {
  id: string;
  role: AppRole;
  fullName: string | null;
  employeeId: string | null;
}

/**
 * Which employee this upload may be filed against.
 *
 * A non-staff caller can only ever write to their own id, which is also what
 * keeps the storage path — and therefore the row's path-scoping rule — honest.
 * Both entry points resolve it here so neither can drift from the other.
 */
export function resolveTargetEmployee(
  filer: Filer,
  requested: string,
): { ok: true; employeeId: string; isStaff: boolean } | { ok: false; error: string } {
  const isStaff = verifyRoles.includes(filer.role);
  const employeeId = isStaff && requested ? requested : filer.employeeId;
  if (!employeeId) {
    return {
      ok: false,
      error: 'Your login is not linked to an employee record, so documents cannot be filed.',
    };
  }
  if (!isStaff && employeeId !== filer.employeeId) {
    return { ok: false, error: 'You can only upload documents against your own record.' };
  }
  return { ok: true, employeeId, isStaff };
}

/**
 * Write the register row for a file that is already stored, then tell HR.
 *
 * Called only once the bytes are safely in GridFS: a row pointing at a file
 * that never landed is worse than a stored file with no row, which is inert.
 */
export async function recordUploadedDocument(input: {
  filer: Filer;
  employeeId: string;
  isStaff: boolean;
  category: string;
  title: string;
  storagePath: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { filer, employeeId, isStaff, category, title, storagePath } = input;
  const dbc = await createClient();

  // A first version: its own group, version 1, current. replaceEmployeeDocument
  // is what continues a chain — this only ever starts one.
  const id = randomUUID();
  const { data, error } = await dbc
    .from('employee_documents')
    .insert({
      id,
      employee_id: employeeId,
      category,
      title,
      storage_path: storagePath,
      uploaded_by: filer.id,
      bucket: uploadBucket,
      doc_group: id,
      version: 1,
      superseded_at: null,
      // Written out rather than left absent. The insert policy pins both to
      // null on a new row, and stating them here says at the write site that an
      // upload is never self-verified.
      verified_by: null,
      verified_at: null,
    })
    .select('id');

  if (error) {
    // 23514 = the path-scoping check. Should be unreachable given
    // resolveTargetEmployee, but say something useful rather than leaking a
    // constraint name.
    if (error.code === '23514') {
      return {
        ok: false,
        error: 'The upload was rejected because its storage path did not match the employee.',
      };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The document was not filed — your account may not have permission.' };
  }

  // Put it in front of HR only when the employee filed it themselves; a document
  // HR just uploaded needs no notification back to HR.
  if (!isStaff) {
    await notifyApprovers(
      {
        kind: 'system',
        title: `${filer.fullName ?? 'An employee'} uploaded a document`,
        body: `${title} — awaiting verification.`,
        link: '/onboarding',
      },
      filer.id,
    );
  }

  revalidatePath('/me');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}
