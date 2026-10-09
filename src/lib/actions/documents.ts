'use server';

/**
 * Document upload and verification actions. Scope storage paths to the target employee and leave
 * uploads unverified until staff review them.
 */

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { createClient, createServiceClient } from '@/lib/db/server-client';
import { getSession } from '@/lib/server-auth';
import { requireDb, requireRoles, wroteNothing } from '@/lib/actions/guards';
import { uploadFile, signedUrl, resolveUploadType } from '@/lib/file-storage';
import { notifyApprovers, notifyEmployee } from '@/lib/notification-delivery';
import { maxBytes, recordUploadedDocument, resolveTargetEmployee, uploadBucket, verifyRoles } from '@/lib/documents/upload';
import { getEmployeeDocuments as readEmployeeDocuments, getEmployeeDocumentHistory as readEmployeeDocumentHistory } from '@/lib/queries/documents';
import type { StorageBucket } from '@/lib/file-storage';

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Uploads and records an employee document via Server Action (staff drawer workflow).
 * Self-service employee locker uploads stream via `/api/documents/upload` instead.
 */
async function uploadEmployeeDocument(formData: FormData): Promise<ActionResult> {
  const db = requireDb('Uploading a document');
  if (!db.ok) {
    return db;
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file to upload.' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: 'Documents must be 10 MB or smaller.' };
  }
  const fileType = resolveUploadType(file.name, 'document');
  if (!fileType.ok) {
    return fileType;
  }

  const category = String(formData.get('category') ?? '').trim() || 'other';
  const title = String(formData.get('title') ?? '').trim() || file.name;
  // A letter sent for signing has to be a PDF, so the employee signs the same pages HR wrote.
  const needsSignature = formData.get('needs_signature') === 'on';
  if (needsSignature && !isPdf(file)) {
    return { ok: false, error: 'A letter sent for signing must be a PDF file.' };
  }

  const { profile } = await getSession();
  if (!profile) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  const filer = {
    id: profile.id,
    role: profile.role,
    fullName: profile.full_name ?? null,
    employeeId: profile.employee_id ?? null,
  };
  // Staff can send the same document to several employees, or to everyone. Each employee gets
  // their own copy on their own record, so signing and verifying stay per person.
  const audience = String(formData.get('audience') ?? 'one');
  const isStaff = verifyRoles.includes(profile.role);
  let employeeIds: string[];
  if (isStaff && audience === 'all') {
    // The list is read here rather than taken from the form.
    const { data: everyone, error: rosterError } = await (
      await createClient()
    )
      .from('employees')
      .select('id')
      .in('status', ['active', 'on_notice'])
      .is('deleted_at', null);
    if (rosterError) {
      return { ok: false, error: rosterError.message };
    }
    employeeIds = (everyone ?? []).map((row: any) => String(row.id));
  } else if (isStaff && audience === 'some') {
    employeeIds = [
      ...new Set(formData.getAll('employee_ids').map((id) => String(id).trim())),
    ].filter(Boolean);
  } else {
    const target = resolveTargetEmployee(filer, String(formData.get('employee_id') ?? '').trim());
    if (!target.ok) {
      return target;
    }
    employeeIds = [target.employeeId];
  }
  if (employeeIds.length === 0) {
    return { ok: false, error: 'Choose at least one employee.' };
  }

  let filed = 0;
  const failures: string[] = [];
  for (const employeeId of employeeIds) {
    // The File is handed over whole rather than buffered here: putObject pipes a
    // Blob, so the bytes go to mongod a chunk at a time instead of being copied
    // twice on the way. Each employee's copy is stored in their own folder.
    const up = await uploadFile(uploadBucket, employeeId, file.name, file, fileType.contentType);
    const result =
      up.ok && up.path
        ? await recordUploadedDocument({
            filer,
            employeeId,
            isStaff,
            category,
            title,
            storagePath: up.path,
            needsSignature,
          })
        : { ok: false, error: up.error ?? 'The document could not be uploaded.' };
    if (result.ok) {
      filed++;
    } else {
      failures.push(result.error ?? 'The document could not be uploaded.');
    }
  }

  if (failures.length === 0) {
    return { ok: true };
  }
  if (employeeIds.length === 1) {
    return { ok: false, error: failures[0] };
  }
  return {
    ok: false,
    error: `Filed for ${filed} of ${employeeIds.length} employees. ${failures.length} could not be filed: ${failures[0]}`,
  };
}

function isPdf(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf');
}

/**
 * The employee returns the signed copy of a letter HR issued for signing. The signed PDF becomes
 * the new version and waits for HR to check it; HR's unsigned letter is kept as the earlier version.
 */
async function uploadSignedDocument(documentId: string, formData: FormData): Promise<ActionResult> {
  const db = requireDb('Uploading a signed letter');
  if (!db.ok) {
    return db;
  }
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose the signed PDF to upload.' };
  }
  if (!isPdf(file)) {
    return { ok: false, error: 'The signed letter must be a PDF file.' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: 'Documents must be 10 MB or smaller.' };
  }

  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  if (!profile || !employeeId) {
    return { ok: false, error: 'Your login is not linked to an employee record.' };
  }

  // Read through the employee's own access, so only their own letter can be answered. The writes
  // below use the service client because employees may not replace a document directly; every
  // predicate names this employee and this letter.
  const { data: letter } = await (
    await createClient()
  )
    .from('employee_documents')
    .select('id, employee_id, category, title, doc_group, version, superseded_at, signature')
    .eq('id', documentId)
    .eq('employee_id', employeeId)
    .maybeSingle<{
      id: string;
      employee_id: string;
      category: string | null;
      title: string | null;
      doc_group: string | null;
      version: number | null;
      superseded_at: Date | null;
      signature: string | null;
    }>();
  if (!letter) {
    return { ok: false, error: 'That letter is no longer available.' };
  }
  if (letter.superseded_at || letter.signature !== 'requested') {
    return { ok: false, error: 'A signed copy of this letter has already been uploaded.' };
  }

  const up = await uploadFile(uploadBucket, employeeId, file.name, file, 'application/pdf');
  if (!up.ok || !up.path) {
    return { ok: false, error: up.error ?? 'The signed letter could not be uploaded.' };
  }

  const service = createServiceClient();
  const signedId = randomUUID();
  const { data: inserted, error: insertError } = await service
    .from('employee_documents')
    .insert({
      id: signedId,
      employee_id: employeeId,
      category: letter.category ?? 'other',
      title: letter.title ?? file.name,
      storage_path: up.path,
      uploaded_by: profile.id,
      bucket: uploadBucket,
      doc_group: letter.doc_group ?? letter.id,
      version: Number(letter.version ?? 1) + 1,
      replaces_id: letter.id,
      superseded_at: null,
      signature: 'signed',
      verified_by: null,
      verified_at: null,
    })
    .select('id');
  if (insertError || wroteNothing(inserted)) {
    return { ok: false, error: insertError?.message ?? 'The signed letter was not filed.' };
  }

  const { data: closed, error: closeError } = await service
    .from('employee_documents')
    .update({ superseded_at: new Date(), replaced_by_id: signedId })
    .eq('id', letter.id)
    .eq('employee_id', employeeId)
    .eq('signature', 'requested')
    .is('superseded_at', null)
    .select('id');
  if (closeError || wroteNothing(closed)) {
    // Someone else answered first; withdraw this copy so the letter has one signed version.
    await service.from('employee_documents').delete().eq('id', signedId);
    return { ok: false, error: 'A signed copy of this letter has already been uploaded.' };
  }

  await notifyApprovers(
    {
      kind: 'system',
      title: `${profile.full_name ?? 'An employee'} returned a signed letter`,
      body: `${letter.title ?? 'Letter'} — check the signed copy and verify it.`,
      link: '/documents',
    },
    profile.id,
  );

  // 'layout' is the refresh scope, not a path: /employee and every tab under it.
  revalidatePath('/employee', 'layout');
  revalidatePath('/documents');
  return { ok: true };
}

/**
 * Replaces an existing document with a new version, preserving the original.
 * This ensures audit continuity — the previous document remains on file even after replacement.
 */
async function replaceEmployeeDocument(
  previousId: string,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await requireRoles(verifyRoles, 'Replacing a document');
  if (!gate.ok) {
    return gate;
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose the replacement file.' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: 'Documents must be 10 MB or smaller.' };
  }
  const fileType = resolveUploadType(file.name, 'document');
  if (!fileType.ok) {
    return fileType;
  }

  const note = String(formData.get('note') ?? '').trim();
  const queryClient = await createClient();

  const { data: previous, error: readErr } = await queryClient
    .from('employee_documents')
    .select(
      'id, employee_id, category, title, bucket, doc_group, version, superseded_at, signature',
    )
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
      signature: string | null;
    }>();
  if (readErr) {
    return { ok: false, error: readErr.message };
  }
  if (!previous) {
    return { ok: false, error: 'That document no longer exists.' };
  }

  // Replacing history would fork the chain — two rows claiming to succeed the
  // same version, with no way to say which is current.
  if (previous.superseded_at) {
    return {
      ok: false,
      error: 'That version has already been replaced. Replace the current one instead.',
    };
  }
  // Letters the system generated in the past are kept as issued; a corrected letter is uploaded
  // as a new document.
  if (previous.bucket === 'generated-documents') {
    return {
      ok: false,
      error:
        'This letter was generated by the system and cannot be replaced. Upload the new letter as a new document.',
    };
  }

  const title = String(formData.get('title') ?? '').trim() || previous.title || file.name;
  // Keep the category when replacing a document so every version describes the same document.
  const category = previous.category ?? 'other';

  const up = await uploadFile(
    uploadBucket,
    previous.employee_id,
    file.name,
    file,
    fileType.contentType,
  );
  if (!up.ok) {
    return { ok: false, error: up.error ?? 'The replacement could not be uploaded.' };
  }

  const nextId = randomUUID();
  const { data: inserted, error: insErr } = await queryClient
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
      // HR correcting a letter before it is signed: the new version is what the employee signs.
      signature: previous.signature === 'requested' ? 'requested' : null,
    })
    .select('id');
  if (insErr) {
    return { ok: false, error: insErr.message };
  }
  if (wroteNothing(inserted)) {
    return {
      ok: false,
      error: 'The replacement was not filed — your account may not have permission.',
    };
  }

  const { error: supErr } = await queryClient
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
    link: '/employee/documents',
  });

  // 'layout' is the refresh scope, not a path: /employee and every tab under it.
  revalidatePath('/employee', 'layout');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/**
 * Verify a filed document or clear its verification with a return reason. Employee policies do not
 * permit deleting or replacing it directly.
 */
async function verifyEmployeeDocument(
  id: string,
  verified: boolean,
  remark?: string,
): Promise<ActionResult> {
  const gate = await requireRoles(verifyRoles, 'Verifying a document');
  if (!gate.ok) {
    return gate;
  }

  const cleanRemark = (remark ?? '').trim();
  if (!verified && !cleanRemark) {
    return { ok: false, error: 'Enter what is wrong with the document.' };
  }

  const queryClient = await createClient();
  // HR's own unsigned letter is not something to verify or send back: it is waiting on the employee.
  const { data: waiting } = await queryClient
    .from('employee_documents')
    .select('signature, superseded_at')
    .eq('id', id)
    .maybeSingle<{ signature: string | null; superseded_at: Date | null }>();
  if (waiting?.signature === 'requested' && !waiting.superseded_at) {
    return {
      ok: false,
      error: 'This letter is waiting for the employee to sign and return it.',
    };
  }
  const { data, error } = await queryClient
    .from('employee_documents')
    .update({
      verified_by: verified ? gate.profileId : null,
      verified_at: verified ? new Date() : null,
      verify_remark: cleanRemark || null,
    })
    .eq('id', id)
    .select('id, employee_id, title');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That document no longer exists.' };
  }

  const row = data![0] as { employee_id: string; title: string | null };
  await notifyEmployee(row.employee_id, {
    kind: 'system',
    title: verified ? 'A document was verified' : 'A document needs attention',
    body: verified
      ? `${row.title ?? 'Your document'} has been verified by HR.`
      : `${row.title ?? 'Your document'} — ${cleanRemark}`,
    link: '/employee/documents',
  });

  revalidatePath('/employee', 'layout');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/**
 * Delete a document as staff. If it is the current version, restore the preceding version so the
 * remaining chain stays visible.
 */
async function deleteEmployeeDocument(id: string): Promise<ActionResult> {
  const gate = await requireRoles(verifyRoles, 'Deleting a document');
  if (!gate.ok) {
    return gate;
  }

  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('employee_documents')
    .delete()
    .eq('id', id)
    .select('id, replaces_id, superseded_at');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'That document no longer exists.' };
  }

  const removed = data![0] as { replaces_id: string | null; superseded_at: Date | null };
  if (!removed.superseded_at && removed.replaces_id) {
    // Best-effort: the delete already succeeded, and reporting failure now
    // would suggest the row is still there. A predecessor left superseded is
    // visible in the employee's history and can be replaced again.
    await queryClient
      .from('employee_documents')
      .update({ superseded_at: null, replaced_by_id: null })
      .eq('id', removed.replaces_id);
  }

  // The storage object is deliberately left in place: the bucket is private and
  // orphaned objects are harmless, whereas deleting the file before the row is
  // confirmed gone risks a row pointing at nothing.
  revalidatePath('/employee', 'layout');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

/** Client-callable history for one employee (queries/documents.ts is server-only). */
async function fetchEmployeeDocumentHistory(employeeId: string) {
  const gate = await requireRoles(verifyRoles, 'Viewing an employee’s documents');
  if (!gate.ok) {
    return [];
  }
  return readEmployeeDocumentHistory(employeeId);
}

/** Resolve a document's file URL. The row read scopes who may ask. */
async function getDocumentUrl(id: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const db = requireDb('Opening a document');
  if (!db.ok) {
    return db;
  }

  const queryClient = await createClient();
  // The SELECT is policy-scoped (staff, or the owning employee), so a caller
  // who cannot see the row gets nothing to open.
  const res = await queryClient
    .from('employee_documents')
    .select('storage_path, bucket')
    .eq('id', id)
    .maybeSingle<{ storage_path: string; bucket: string | null }>();
  const { data, error } = res;
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data?.storage_path) {
    return { ok: false, error: 'That document is not available to you.' };
  }

  // Use the document's assigned storage folder, defaulting to 'employee-documents'.
  const bucket = (data.bucket ?? uploadBucket) as StorageBucket;
  const signed = await signedUrl(bucket, data.storage_path);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
}

/** Client-callable document list for one employee (queries/documents.ts is server-only). */
async function fetchEmployeeDocuments(employeeId: string) {
  return readEmployeeDocuments(employeeId);
}

export {
  uploadEmployeeDocument,
  uploadSignedDocument,
  replaceEmployeeDocument,
  verifyEmployeeDocument,
  deleteEmployeeDocument,
  fetchEmployeeDocumentHistory,
  getDocumentUrl,
  fetchEmployeeDocuments,
};
export type { StorageBucket, ActionResult };
