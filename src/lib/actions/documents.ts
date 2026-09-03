'use server';

// ============================================================================
// Employee document register + HR verification.
//
// Files live in the private `employee-documents` bucket (0032) under
// `<employee_id>/<uuid>-<filename>`; the row only ever carries the path, and
// the bytes are served by /api/files, which re-checks the session on every
// request. Two invariants come straight from the migration and must not be
// bypassed here:
//
//   1. `employee_documents_path_scoped` — the row's storage_path MUST begin with
//      its own employee_id. That prefix is what lib/db/gridfs.ts checks to
//      decide who may open the object, so a row whose path points into another
//      employee's folder would hand out that employee's file.
//   2. No self-verification — the employee insert policy pins verified_by /
//      verified_at to null; only an admin/HR UPDATE can stamp them.
//
// The verify flow is modelled on reviewReimbursement: a decision, a reviewer, a
// timestamp, and a remark that the subject can read.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { uploadFile, signedUrl, resolveUploadType, type StorageBucket } from '@/lib/storage';
import { notifyEmployee, notifyApprovers } from '@/lib/notify';
import {
  getEmployeeDocuments as readEmployeeDocuments,
  getEmployeeDocumentHistory as readEmployeeDocumentHistory,
} from '@/lib/queries';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const VERIFY_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];
// Where UPLOADS go. Reads must not assume it — HR-issued letters live in
// generated-documents and the row's `bucket` column (0039) says which is which.
const UPLOAD_BUCKET: StorageBucket = 'employee-documents';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — certificates scan large

// DOCUMENT_CATEGORIES used to live here, but this is a 'use server' module and
// Next only allows async functions to be exported from one — a plain const
// fails the build before type-checking even runs. It now lives in
// @/lib/constants, which both this file and the client form can import.

/**
 * Upload a document for an employee.
 *
 * An employee may upload their OWN (0037 insert-own policy); admin/HR may upload
 * for anyone. `targetEmployeeId` is therefore validated against the caller: a
 * non-staff caller can only ever write to their own id, which also satisfies the
 * path-scoping constraint.
 */
export async function uploadEmployeeDocument(formData: FormData): Promise<ActionResult> {
  const db = requireDb('Uploading a document');
  if (!db.ok) return db;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file to upload.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'Documents must be 10 MB or smaller.' };
  const fileType = resolveUploadType(file.name, 'document');
  if (!fileType.ok) return fileType;

  const category = String(formData.get('category') ?? '').trim() || 'other';
  const title = String(formData.get('title') ?? '').trim() || file.name;
  const requested = String(formData.get('employee_id') ?? '').trim();

  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const isStaff = VERIFY_ROLES.includes(profile.role);
  const ownId = profile.employee_id;

  // Non-staff may only ever upload against their own record — this is what keeps
  // the storage path (and therefore the row's scoping constraint) honest.
  const employeeId = isStaff && requested ? requested : ownId;
  if (!employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record, so documents cannot be filed.' };
  }
  if (!isStaff && employeeId !== ownId) {
    return { ok: false, error: 'You can only upload documents against your own record.' };
  }

  const dbc = await createClient();
  const up = await uploadFile(
    UPLOAD_BUCKET,
    employeeId,
    file.name,
    await file.arrayBuffer(),
    fileType.contentType,
  );
  if (!up.ok) return { ok: false, error: up.error ?? 'The document could not be uploaded.' };

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
      storage_path: up.path,
      uploaded_by: profile.id,
      bucket: UPLOAD_BUCKET,
      doc_group: id,
      version: 1,
      superseded_at: null,
    })
    .select('id');
  if (error) {
    // 23514 = the path-scoping check. Should be unreachable given the guard
    // above, but say something useful rather than leaking a constraint name.
    if (error.code === '23514') {
      return { ok: false, error: 'The upload was rejected because its storage path did not match the employee.' };
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
        title: `${profile.full_name ?? 'An employee'} uploaded a document`,
        body: `${title} — awaiting verification.`,
        link: '/onboarding',
      },
      profile.id,
    );
  }

  revalidatePath('/me');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/**
 * Replace a document with a newer file, KEEPING the one it replaces.
 *
 * This is the "a document changes during onboarding or later in employment"
 * case: an ID proof expires, HR returns a scan that was cut off, a bank letter
 * is reissued. The old row is not edited in place and not deleted — it is
 * stamped superseded and stays on file, because "what did we hold in March" is
 * a question an audit asks and an overwritten row cannot answer.
 *
 * The new version always lands AWAITING VERIFICATION, whatever the state of the
 * one it replaces. A replacement that inherited a verified stamp would let a
 * verified document be swapped for an unchecked file without anyone looking at
 * it, which is the whole point of the verification step.
 *
 * ORDER MATTERS. The new row is inserted first and the old one is stamped
 * second: an interruption between them leaves two current versions (visible,
 * fixable) rather than none (the document vanishes from the register while its
 * file still exists). The reverse order can lose sight of a document entirely.
 */
export async function replaceEmployeeDocument(
  previousId: string,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await requireRoles(VERIFY_ROLES, 'Replacing a document');
  if (!gate.ok) return gate;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose the replacement file.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'Documents must be 10 MB or smaller.' };
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
    return { ok: false, error: 'That version has already been replaced. Replace the current one instead.' };
  }
  // An issued letter is authoritative and is reproduced from /exits, not
  // swapped for an upload here.
  if (previous.bucket === 'generated-documents') {
    return {
      ok: false,
      error: 'An HR-issued letter cannot be replaced by an upload — generate it again from the exit case.',
    };
  }

  const title = String(formData.get('title') ?? '').trim() || previous.title || file.name;
  // The category is carried over, not re-asked: a replacement is the SAME
  // document, and letting it change category would break the chain's meaning.
  const category = previous.category ?? 'other';

  const up = await uploadFile(
    UPLOAD_BUCKET,
    previous.employee_id,
    file.name,
    await file.arrayBuffer(),
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
      bucket: UPLOAD_BUCKET,
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
    return { ok: false, error: 'The replacement was not filed — your account may not have permission.' };
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
  const gate = await requireRoles(VERIFY_ROLES, 'Verifying a document');
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
  const gate = await requireRoles(VERIFY_ROLES, 'Deleting a document');
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
  const gate = await requireRoles(VERIFY_ROLES, 'Viewing an employee’s documents');
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

  // Documents arrive from two buckets — uploads land in employee-documents,
  // HR-issued letters in generated-documents. Signing every path against the
  // former is what made every issued letter "Object not found". `bucket` arrived
  // in 0039; anything written before it is an upload.
  const bucket = (data.bucket ?? UPLOAD_BUCKET) as StorageBucket;
  const signed = await signedUrl(bucket, data.storage_path);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
}

/** Client-callable document list for one employee (queries.ts is server-only). */
export async function fetchEmployeeDocuments(employeeId: string) {
  return readEmployeeDocuments(employeeId);
}
