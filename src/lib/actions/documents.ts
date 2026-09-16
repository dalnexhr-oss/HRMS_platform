'use server';

/**
 * Document upload and verification actions. Scope storage paths to the target employee and leave
 * uploads unverified until staff review them.
 */

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireRoles, wroteNothing } from '@/lib/actions/guards';
import { uploadFile, signedUrl, resolveUploadType, type StorageBucket } from '@/lib/storage';
import { notifyEmployee } from '@/lib/notify';
import {
  maxBytes,
  recordUploadedDocument,
  resolveTargetEmployee,
  uploadBucket,
  verifyRoles,
} from '@/lib/documents/upload';
import {
  getEmployeeDocuments as readEmployeeDocuments,
  getEmployeeDocumentHistory as readEmployeeDocumentHistory,
} from '@/lib/queries';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Uploads and records an employee document via Server Action (staff drawer workflow).
 * Self-service employee locker uploads stream via `/api/documents/upload` instead.
 */
export async function uploadEmployeeDocument(formData: FormData): Promise<ActionResult> {
  const db = requireDb('Uploading a document');
  if (!db.ok) return db;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: 'Choose a file to upload.' };
  if (file.size > maxBytes) return { ok: false, error: 'Documents must be 10 MB or smaller.' };
  const fileType = resolveUploadType(file.name, 'document');
  if (!fileType.ok) return fileType;

  const category = String(formData.get('category') ?? '').trim() || 'other';
  const title = String(formData.get('title') ?? '').trim() || file.name;

  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const filer = {
    id: profile.id,
    role: profile.role,
    fullName: profile.full_name ?? null,
    employeeId: profile.employee_id ?? null,
  };
  const target = resolveTargetEmployee(filer, String(formData.get('employee_id') ?? '').trim());
  if (!target.ok) return target;

  // The File is handed over whole rather than buffered here: putObject pipes a
  // Blob, so the bytes go to mongod a chunk at a time instead of being copied
  // twice on the way.
  const up = await uploadFile(
    uploadBucket,
    target.employeeId,
    file.name,
    file,
    fileType.contentType,
  );
  if (!up.ok || !up.path) {
    return { ok: false, error: up.error ?? 'The document could not be uploaded.' };
  }

  return recordUploadedDocument({
    filer,
    employeeId: target.employeeId,
    isStaff: target.isStaff,
    category,
    title,
    storagePath: up.path,
  });
}

/**
 * Replaces an existing document with a new version, preserving the original.
 * This ensures audit continuity — the previous document remains on file even after replacement.
 */
export async function replaceEmployeeDocument(
  previousId: string,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await requireRoles(verifyRoles, 'Replacing a document');
  if (!gate.ok) return gate;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: 'Choose the replacement file.' };
  if (file.size > maxBytes) return { ok: false, error: 'Documents must be 10 MB or smaller.' };
  const fileType = resolveUploadType(file.name, 'document');
  if (!fileType.ok) return fileType;

  const note = String(formData.get('note') ?? '').trim();
  const dbc = await createClient();

  const { data: previous, error: readErr } = await dbc
    .from('employee_documents')
    .select('id, employee_id, category, title, bucket, doc_group, version, superseded_at')
    .eq('id', previousId)
    .maybeSingle<{
      id: string;
      employee_id: string;
      category: string | null;
      title: string | null;
      bucket: string | null;
      doc_group: string | null;
      version: number | null;
      superseded_at: Date | null;
    }>();
  if (readErr) return { ok: false, error: readErr.message };
  if (!previous) return { ok: false, error: 'That document no longer exists.' };

  // Replacing history would fork the chain — two rows claiming to succeed the
  // same version, with no way to say which is current.
  if (previous.superseded_at) {
    return {
      ok: false,
      error: 'That version has already been replaced. Replace the current one instead.',
    };
  }
  // An issued letter is authoritative and is reproduced from /exits, not
  // swapped for an upload here.
  if (previous.bucket === 'generated-documents') {
    return {
      ok: false,
      error:
        'An HR-issued letter cannot be replaced by an upload — generate it again from the exit case.',
    };
  }

  const title = String(formData.get('title') ?? '').trim() || previous.title || file.name;
  // The category is carried over, not re-asked: a replacement is the SAME
  // document, and letting it change category would break the chain's meaning.
  const category = previous.category ?? 'other';

  const up = await uploadFile(
    uploadBucket,
    previous.employee_id,
    file.name,
    file,
    fileType.contentType,
  );
  if (!up.ok) return { ok: false, error: up.error ?? 'The replacement could not be uploaded.' };

  const nextId = randomUUID();
  const { data: inserted, error: insErr } = await dbc
    .from('employee_documents')
    .insert({
      id: nextId,
      employee_id: previous.employee_id,
      category,
      title,
      storage_path: up.path,
      uploaded_by: gate.profileId,
      bucket: uploadBucket,
      // Rows predating versioning carry no group; the chain starts at the row
      // being replaced, which is exactly what mapDocument() already reports.
      doc_group: previous.doc_group ?? previous.id,
      version: Number(previous.version ?? 1) + 1,
      replaces_id: previous.id,
      superseded_at: null,
      // Explicitly unverified — see the note above.
      verified_by: null,
      verified_at: null,
      verify_remark: note || null,
    })
    .select('id');
  if (insErr) return { ok: false, error: insErr.message };
  if (wroteNothing(inserted)) {
    return {
      ok: false,
      error: 'The replacement was not filed — your account may not have permission.',
    };
  }

  const { error: supErr } = await dbc
    .from('employee_documents')
    .update({ superseded_at: new Date(), replaced_by_id: nextId })
    .eq('id', previous.id)
    .is('superseded_at', null);
  if (supErr) {
    return {
      ok: false,
      error:
        `The replacement was filed, but the previous version could not be closed off (${supErr.message}). ` +
        'Both now show as current — replace again or ask an administrator to tidy it.',
    };
  }

  await notifyEmployee(previous.employee_id, {
    kind: 'system',
    title: 'A document was updated',
    body: `${title} — a new version is on file and awaiting verification.`,
    link: '/me#documents',
  });

  revalidatePath('/me');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/**
 * HR verifies (or returns) a filed document.
 *
 * `verified` false CLEARS the stamp and records why, so a rejected document is
 * visibly unverified with a reason rather than silently deleted — the employee
 * cannot delete or replace it themselves (no employee UPDATE/DELETE policy).
 */
export async function verifyEmployeeDocument(
  id: string,
  verified: boolean,
  remark?: string,
): Promise<ActionResult> {
  const gate = await requireRoles(verifyRoles, 'Verifying a document');
  if (!gate.ok) return gate;

  const cleanRemark = (remark ?? '').trim();
  if (!verified && !cleanRemark) {
    return { ok: false, error: 'Enter what is wrong with the document.' };
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .update({
      verified_by: verified ? gate.profileId : null,
      verified_at: verified ? new Date() : null,
      verify_remark: cleanRemark || null,
    })
    .eq('id', id)
    .select('id, employee_id, title');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That document no longer exists.' };

  const row = data![0] as { employee_id: string; title: string | null };
  await notifyEmployee(row.employee_id, {
    kind: 'system',
    title: verified ? 'A document was verified' : 'A document needs attention',
    body: verified
      ? `${row.title ?? 'Your document'} has been verified by HR.`
      : `${row.title ?? 'Your document'} — ${cleanRemark}`,
    link: '/me#documents',
  });

  revalidatePath('/me');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/**
 * Remove a filed document. Staff-only — the subject cannot erase their own record.
 *
 * Deleting the CURRENT version of a chain restores the one before it rather
 * than leaving the document with no live version. Without that, deleting a bad
 * replacement would take the whole document off the register while every
 * earlier version sat on file marked superseded — the file would still exist
 * and nothing would show it.
 */
export async function deleteEmployeeDocument(id: string): Promise<ActionResult> {
  const gate = await requireRoles(verifyRoles, 'Deleting a document');
  if (!gate.ok) return gate;

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .delete()
    .eq('id', id)
    .select('id, replaces_id, superseded_at');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That document no longer exists.' };

  const removed = data![0] as { replaces_id: string | null; superseded_at: Date | null };
  if (!removed.superseded_at && removed.replaces_id) {
    // Best-effort: the delete already succeeded, and reporting failure now
    // would suggest the row is still there. A predecessor left superseded is
    // visible in the employee's history and can be replaced again.
    await dbc
      .from('employee_documents')
      .update({ superseded_at: null, replaced_by_id: null })
      .eq('id', removed.replaces_id);
  }

  // The storage object is deliberately left in place: the bucket is private and
  // orphaned objects are harmless, whereas deleting the file before the row is
  // confirmed gone risks a row pointing at nothing.
  revalidatePath('/me');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/** Client-callable history for one employee (queries.ts is server-only). */
export async function fetchEmployeeDocumentHistory(employeeId: string) {
  const gate = await requireRoles(verifyRoles, 'Viewing an employee’s documents');
  if (!gate.ok) return [];
  return readEmployeeDocumentHistory(employeeId);
}

/** Resolve a document's file URL. The row read scopes who may ask. */
export async function getDocumentUrl(
  id: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const db = requireDb('Opening a document');
  if (!db.ok) return db;

  const dbc = await createClient();
  // The SELECT is policy-scoped (staff, or the owning employee), so a caller
  // who cannot see the row gets nothing to open.
  const res = await dbc
    .from('employee_documents')
    .select('storage_path, bucket')
    .eq('id', id)
    .maybeSingle<{ storage_path: string; bucket: string | null }>();
  const { data, error } = res;
  if (error) return { ok: false, error: error.message };
  if (!data?.storage_path) return { ok: false, error: 'That document is not available to you.' };

  // Resolve storage bucket (defaults to 'employee-documents' for legacy uploads).
  const bucket = (data.bucket ?? uploadBucket) as StorageBucket;
  const signed = await signedUrl(bucket, data.storage_path);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
}

/** Client-callable document list for one employee (queries.ts is server-only). */
export async function fetchEmployeeDocuments(employeeId: string) {
  return readEmployeeDocuments(employeeId);
}
