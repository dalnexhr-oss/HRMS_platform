import { requiredDocumentKeys } from '@/lib/document-categories';
import type { DocumentType } from '@/lib/document-categories';

// documents

/**
 * Issued documents come from generateExitDocument and are already verified. They cannot be
 * replaced through uploads; use source to distinguish issued experience letters from uploaded
 * certificates.
 */
type DocumentSource = 'uploaded' | 'issued';

/**
 * Document status: waiting for the employee to sign and return it, awaiting review, returned with
 * an HR remark, verified, or superseded by a newer version.
 */
type DocumentStatus = 'to_sign' | 'awaiting' | 'returned' | 'verified' | 'superseded';

/**
 * Where a letter HR issued for signing stands. 'requested' is HR's unsigned letter, waiting for the
 * employee; 'signed' is the copy the employee sent back. Null for ordinary documents.
 */
type DocumentSignature = 'requested' | 'signed' | null;

interface EmployeeDocumentRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  category: string | null;
  title: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  verifyRemark: string | null;
  source: DocumentSource;
  status: DocumentStatus;
  signature: DocumentSignature;
  version: number;
  /** The first version's id — every version of one document shares it. */
  docGroup: string;
  supersededAt: string | null;
  /** True when this row is the live version. */
  isCurrent: boolean;
}

interface DocumentStats {
  /** Current documents on file, all employees. */
  total: number;
  awaiting: number;
  returned: number;
  /** Letters sent to employees that have not come back signed yet. */
  toSign: number;
  /**
   * Required categories not on file, summed over ACTIVE employees.
   *
   * Counts gaps, not people: an employee missing three of the four required
   * categories contributes three. `employeesMissing` is the headcount.
   */
  missing: number;
  employeesMissing: number;
}

/** Derive document KPIs from the same register data used by the table. */
function documentStats(
  register: EmployeeDocumentRow[],
  // People on the roll; exit documents are required only from those who are leaving.
  employees: Array<{ id: string; leaving: boolean }>,
  types: readonly DocumentType[],
): DocumentStats {
  let awaiting = 0;
  let returned = 0;
  let toSign = 0;
  const heldByEmployee = new Map<string, Set<string>>();

  for (const d of register) {
    if (d.status === 'to_sign') {
      toSign++;
    }
    if (d.status === 'awaiting') {
      awaiting++;
    }
    if (d.status === 'returned') {
      returned++;
    }
    // Only a VERIFIED upload counts as held: an unverified or returned scan is
    // exactly the gap the missing count is meant to surface.
    if (d.status === 'verified' && d.category) {
      let held = heldByEmployee.get(d.employeeId);
      if (!held) {
        heldByEmployee.set(d.employeeId, (held = new Set()));
      }
      held.add(d.category);
    }
  }

  let missing = 0;
  let employeesMissing = 0;
  for (const employee of employees) {
    const held = heldByEmployee.get(employee.id);
    const gaps = requiredDocumentKeys(types, employee.leaving).filter((c) => !held?.has(c)).length;
    if (gaps > 0) {
      employeesMissing++;
    }
    missing += gaps;
  }

  return { total: register.length, awaiting, returned, toSign, missing, employeesMissing };
}

export { documentStats };

export type {
  DocumentSource,
  DocumentStatus,
  DocumentSignature,
  EmployeeDocumentRow,
  DocumentStats,
};
