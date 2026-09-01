import { redirect } from 'next/navigation';
import { DocumentsScreen } from '@/components/documents/DocumentsScreen';
import { getDocumentRegister, getEmployeeOptions, documentStats } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// The document register exposes every employee's paperwork, so it is gated to
// the same tier that may verify it — VERIFY_ROLES in actions/documents.ts. The
// nav gate in constants.ts only hides the link; this is the check that counts,
// and the collection policies gate the data underneath either way.
const DOCUMENT_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function DocumentsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !DOCUMENT_ROLES.includes(role)) redirect('/today');

  const [register, employees] = await Promise.all([getDocumentRegister(), getEmployeeOptions()]);

  // Derived from the register that is already loaded rather than counted with
  // five more round trips. getEmployeeOptions() is the ACTIVE roster, which is
  // the right denominator for "missing": paperwork gaps on someone who has left
  // are not work anyone is going to do.
  const stats = documentStats(register, employees.map((e) => e.id));

  return <DocumentsScreen register={register} stats={stats} employees={employees} />;
}
