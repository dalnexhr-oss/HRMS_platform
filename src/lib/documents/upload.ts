/**
 * Shared upload validation and registration for form-based Server Actions and the streaming
 * document route.
 */
import { queryErrorCodes } from '@/lib/db/query-errors';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server-client';
import { db } from '@/lib/db/mongodb-connection';
import { deleteObject } from '@/lib/db/gridfs-file-storage';
import { wroteNothing } from '@/lib/actions/guards';
import { notifyApprovers, notifyEmployee } from '@/lib/notification-delivery';
import { getDocumentTypes } from '@/lib/queries/document-settings';
import type { StorageBucket } from '@/lib/file-storage';
import type { AppRole } from '@/types/database';

/** Roles permitted to file documents for other employees and verify submissions. */
const verifyRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

/** Target storage bucket for uploaded documents. */
const uploadBucket: StorageBucket = 'employee-documents';

/** Maximum permitted document size in bytes (10 MB). */
const maxBytes = 10 * 1024 * 1024;

interface Filer {
  id: string;
  role: AppRole;
  fullName: string | null;
  employeeId: string | null;
}

/**
 * Resolves and validates the target employee ID for an upload.
 * Enforces that non-staff callers can only file documents against their own employee record.
 */
function resolveTargetEmployee(
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
 * Persists document metadata in the register after storage write succeeds and notifies HR.
 */
async function recordUploadedDocument(input: {
  filer: Filer;
  employeeId: string;
  isStaff: boolean;
  category: string;
  title: string;
  storagePath: string;
  // True when HR is issuing a letter the employee has to sign and send back.
  needsSignature?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { filer, employeeId, isStaff, category, title, storagePath } = input;
  const needsSignature = input.needsSignature === true && isStaff;
  let registered = false;
  try {
    const dbc = await createClient();
    const offered = (await getDocumentTypes()).filter((type) => type.active);
    if (!offered.some((type) => type.key === category)) {
      return {
        ok: false,
        error: 'That document type is no longer in use. Reload the page and choose another.',
      };
    }

    // Initialize document chain (version 1, doc_group = id).
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
        signature: needsSignature ? 'requested' : null,
        // Unverified by default on creation; verification requires staff review.
        verified_by: null,
        verified_at: null,
      })
      .select('id');

    if (error) {
      // Storage path constraint violation (must match employee ID prefix).
      if (error.code === queryErrorCodes.validationFailed) {
        return {
          ok: false,
          error: 'The upload was rejected because its storage path did not match the employee.',
        };
      }
      return { ok: false, error: error.message };
    }
    if (wroteNothing(data)) {
      return {
        ok: false,
        error: 'The document was not filed — your account may not have permission.',
      };
    }
    registered = true;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The document was not filed.',
    };
  } finally {
    if (!registered) {
      await discardUnfiledUpload(storagePath);
    }
  }

  if (needsSignature) {
    await notifyEmployee(employeeId, {
      kind: 'system',
      title: 'A letter needs your signature',
      body: `${title} — download it, sign it and upload the signed copy.`,
      link: '/employee/documents',
    });
  }

  // Notify approvers only on self-service uploads by employees.
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

  // 'layout' is the refresh scope, not a path: /employee and every tab under it.
  revalidatePath('/employee', 'layout');
  revalidatePath('/documents');
  revalidatePath('/onboarding');
  return { ok: true };
}

async function discardUnfiledUpload(storagePath: string): Promise<void> {
  try {
    // A lost acknowledgement can report failure after insertion. Keep files that have a record.
    const saved = await (
      await db()
    )
      .collection('employee_documents')
      .findOne({ storage_path: storagePath, bucket: uploadBucket }, { projection: { _id: 1 } });
    if (!saved) {
      await deleteObject(uploadBucket, storagePath);
    }
  } catch (error) {
    console.error('Could not clean up an unfiled document upload:', error);
  }
}

export { verifyRoles, uploadBucket, maxBytes, resolveTargetEmployee, recordUploadedDocument };

export type { Filer };
