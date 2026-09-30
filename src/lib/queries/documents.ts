import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail, iso, isoOrNull } from '@/lib/queries/shared';
import type { DocumentStatus, EmployeeDocumentRow } from '@/lib/documents/document-summary';

// e-signatures
interface AcknowledgementRow {
  id: string;
  documentKind: string;
  documentId: string | null;
  signedName: string;
  signedAt: string;
}

/**
 * Append-only employee signatures, including typed name, server timestamp, and request IP. Policy
 * read receipts are stored separately.
 */
async function getMyAcknowledgements(employeeId: string): Promise<AcknowledgementRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('acknowledgements')
    .select('id, document_kind, document_id, signed_name, signed_at')
    .eq('employee_id', employeeId)
    .order('signed_at', { ascending: false });
  if (error) {
    fail('getMyAcknowledgements: could not load signatures', error);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    documentKind: r.document_kind,
    documentId: r.document_id,
    signedName: r.signed_name,
    signedAt: iso(r.signed_at),
  }));
}

const documentFields =
  'id, employee_id, category, title, uploaded_at, verified_at, verify_remark, bucket, ' +
  'doc_group, version, replaces_id, replaced_by_id, superseded_at, employees(code, full_name)';

function documentStatus(r: any): DocumentStatus {
  if (r.superseded_at) {
    return 'superseded';
  }
  if (r.verified_at) {
    return 'verified';
  }
  return r.verify_remark ? 'returned' : 'awaiting';
}

function mapDocument(r: any): EmployeeDocumentRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    code: r.employees?.code ?? '',
    name: r.employees?.full_name ?? '',
    category: r.category,
    title: r.title,
    uploadedAt: iso(r.uploaded_at),
    verifiedAt: isoOrNull(r.verified_at),
    verifyRemark: r.verify_remark,
    source: r.bucket === 'generated-documents' ? 'issued' : 'uploaded',
    status: documentStatus(r),
    // Unversioned legacy records default to version 1 and active (non-superseded) state.
    version: Number(r.version ?? 1),
    docGroup: r.doc_group ?? r.id,
    supersededAt: isoOrNull(r.superseded_at),
    isCurrent: !r.superseded_at,
  };
}

/**
 * Return the employee's current documents, newest first, without storage paths. Staff can read
 * superseded versions through getEmployeeDocumentHistory.
 */
async function getEmployeeDocuments(employeeId: string): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(documentFields)
    .eq('employee_id', employeeId)
    .is('superseded_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) {
    fail('getEmployeeDocuments: could not load documents', error);
  }
  return (data ?? []).map(mapDocument);
}

/**
 * EVERY version of every document for one employee, newest first — the staff
 * drill-down. Superseded rows are included; `isCurrent` and `docGroup` are what
 * the panel groups on.
 */
async function getEmployeeDocumentHistory(employeeId: string): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(documentFields)
    .eq('employee_id', employeeId)
    .order('uploaded_at', { ascending: false });
  if (error) {
    fail('getEmployeeDocumentHistory: could not load the document history', error);
  }
  return (data ?? []).map(mapDocument);
}

/**
 * Return current document versions for the register. Keep superseded versions in each document's
 * history.
 */
async function getDocumentRegister(): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(documentFields)
    .is('superseded_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) {
    fail('getDocumentRegister: could not load the document register', error);
  }
  return (data ?? []).map(mapDocument);
}

/**
 * Return current documents awaiting HR verification. Superseded versions are excluded from the
 * review queue.
 */
async function getUnverifiedDocuments(): Promise<EmployeeDocumentRow[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employee_documents')
    .select(documentFields)
    .is('verified_at', null)
    .is('superseded_at', null)
    .order('uploaded_at', { ascending: true });
  if (error) {
    fail('getUnverifiedDocuments: could not load the verification queue', error);
  }
  return (data ?? []).map(mapDocument);
}

export {
  getMyAcknowledgements,
  getEmployeeDocuments,
  getEmployeeDocumentHistory,
  getDocumentRegister,
  getUnverifiedDocuments,
};

export type { AcknowledgementRow };
