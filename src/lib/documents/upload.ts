/**
 * Shared upload validation and registration for form-based Server Actions and the streaming
 * document route.
 */
import { queryErrorCodes } from '@/lib/db/errors';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { db } from '@/lib/db/mongo';
import { deleteObject } from '@/lib/db/gridfs';
import { wroteNothing } from '@/lib/actions/guards';
import { notifyApprovers } from '@/lib/notify';
import type { StorageBucket } from '@/lib/storage';
import type { AppRole } from '@/types/database';

/** Roles permitted to file documents for other employees and verify submissions. */
export const verifyRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

/** Target storage bucket for uploaded documents. */
export const uploadBucket: StorageBucket = 'employee-documents';

/** Maximum permitted document size in bytes (10 MB). */
export const maxBytes = 10 * 1024 * 1024;

export interface Filer {
  id: string;
  role: AppRole;
  fullName: string | null;
  employeeId: string | null;
}

/**
 * Resolves and validates the target employee ID for an upload.
 * Enforces that non-staff callers can only file documents against their own employee record.
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
 * Persists document metadata in the register after storage write succeeds and notifies HR.
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
  let registered = false;
  try {
    const dbc = await createClient();

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

  revalidatePath('/me');
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
