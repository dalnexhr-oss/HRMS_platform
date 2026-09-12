import { redirect } from 'next/navigation';
import { DocumentsScreen } from '@/components/documents/DocumentsScreen';
import { getDocumentRegister, getEmployeeOptions, documentStats } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Document management is accessible to super_admin/admin/HR.
const documentRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function DocumentsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !documentRoles.includes(role)) redirect('/today');

  const [register, employees] = await Promise.all([getDocumentRegister(), getEmployeeOptions()]);

  // Derived from the register that is already loaded rather than counted with
  // five more round trips. getEmployeeOptions() is the ACTIVE roster, which is
  // the right denominator for "missing": paperwork gaps on someone who has left
  // are not work anyone is going to do.
  const stats = documentStats(register, employees.map((e) => e.id));

  return <DocumentsScreen register={register} stats={stats} employees={employees} />;
}
