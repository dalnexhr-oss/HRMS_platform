import { requiredDocumentCategories } from '@/lib/document-categories';

// documents

/**
 * Issued documents come from generateExitDocument and are already verified. They cannot be
 * replaced through uploads; use source to distinguish issued experience letters from uploaded
 * certificates.
 */
type DocumentSource = 'uploaded' | 'issued';

/**
 * Document status: awaiting review, returned with an HR remark, verified, or superseded by a newer
 * version.
 */
type DocumentStatus = 'awaiting' | 'returned' | 'verified' | 'superseded';

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
  /** HR-generated letters (relieving / experience / F&F). */
  issued: number;
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
  activeEmployeeIds: string[],
): DocumentStats {
  let awaiting = 0;
  let returned = 0;
  let issued = 0;
  const heldByEmployee = new Map<string, Set<string>>();

  for (const d of register) {
    if (d.source === 'issued') {
      issued++;
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
  for (const id of activeEmployeeIds) {
    const held = heldByEmployee.get(id);
    const gaps = requiredDocumentCategories.filter((c) => !held?.has(c)).length;
    if (gaps > 0) {
      employeesMissing++;
    }
    missing += gaps;
  }

  return { total: register.length, awaiting, returned, issued, missing, employeesMissing };
}

export { documentStats };

export type { DocumentSource, DocumentStatus, EmployeeDocumentRow, DocumentStats };
