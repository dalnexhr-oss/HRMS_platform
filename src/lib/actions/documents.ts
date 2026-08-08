'use server';

// ============================================================================
// Employee document register + HR verification (migration 0037).
//
// Files live in the private `employee-documents` bucket (0032) under
// `<employee_id>/<uuid>-<filename>`; the row only ever carries the path, and
// access is by short-lived signed URL. Two invariants come straight from the
// migration and must not be bypassed here:
//
//   1. `employee_documents_path_scoped` — the row's storage_path MUST begin with
//      its own employee_id. Signed URLs are minted server-side (bypassing
//      storage RLS), so without the row being scoped too, a crafted path could
//      read another employee's folder.
//   2. No self-verification — the employee insert policy pins verified_by /
//      verified_at to null; only an admin/HR UPDATE can stamp them.
//
// The verify flow is modelled on reviewReimbursement: a decision, a reviewer, a
// timestamp, and a remark that the subject can read.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireRoles, wroteNothing } from '@/lib/actions/_guard';
import { uploadFile, signedUrl, resolveUploadType, type StorageBucket } from '@/lib/storage';
import { notifyEmployee, notifyApprovers } from '@/lib/notify';
import { getEmployeeDocuments as readEmployeeDocuments } from '@/lib/queries';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const VERIFY_ROLES: AppRole[] = ['admin', 'hr'];
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

  const supabase = await createClient();
  const up = await uploadFile(
    supabase,
    UPLOAD_BUCKET,
    employeeId,
    file.name,
    await file.arrayBuffer(),
    fileType.contentType,
  );
  if (!up.ok) return { ok: false, error: up.error ?? 'The document could not be uploaded.' };

  const { data, error } = await supabase
    .from('employee_documents')
    .insert({
      employee_id: employeeId,
      category,
      title,
      storage_path: up.path,
      uploaded_by: profile.id,
    })
    .select('id');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'Document management is not set up on the database yet — apply migration 0037.' };
    }
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employee_documents')
    .update({
      verified_by: verified ? gate.profileId : null,
      verified_at: verified ? new Date().toISOString() : null,
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
  revalidatePath('/onboarding');
  return { ok: true };
}

/** Remove a filed document. Staff-only — the subject cannot erase their own record. */
export async function deleteEmployeeDocument(id: string): Promise<ActionResult> {
  const gate = await requireRoles(VERIFY_ROLES, 'Deleting a document');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employee_documents')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) return { ok: false, error: 'That document no longer exists.' };

  // The storage object is deliberately left in place: the bucket is private and
  // orphaned objects are harmless, whereas deleting the file before the row is
  // confirmed gone risks a row pointing at nothing.
  revalidatePath('/me');
  revalidatePath('/onboarding');
  return { ok: true };
}

/** Mint a short-lived signed URL. RLS on the row read scopes who may ask. */
export async function getDocumentUrl(
  id: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const db = requireDb('Opening a document');
  if (!db.ok) return db;

  const supabase = await createClient();
  // The SELECT is RLS-scoped (staff, or the owning employee), so a caller who
  // cannot see the row gets nothing to sign.
  const { data, error } = await supabase
    .from('employee_documents')
    .select('storage_path, bucket')
    .eq('id', id)
    .maybeSingle<{ storage_path: string; bucket: string | null }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.storage_path) return { ok: false, error: 'That document is not available to you.' };

  // Documents arrive from two buckets — uploads land in employee-documents,
  // HR-issued letters in generated-documents. Signing every path against the
  // former is what made every issued letter "Object not found". `bucket` arrived
  // in 0039; anything written before it is an upload.
  const bucket = (data.bucket ?? UPLOAD_BUCKET) as StorageBucket;
  const signed = await signedUrl(supabase, bucket, data.storage_path);
  return signed.ok ? { ok: true, url: signed.url } : { ok: false, error: signed.error };
}

/** Client-callable document list for one employee (queries.ts is server-only). */
export async function fetchEmployeeDocuments(employeeId: string) {
  return readEmployeeDocuments(employeeId);
}
