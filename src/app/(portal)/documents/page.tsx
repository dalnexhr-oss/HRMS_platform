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
  if (!role || !documentRoles.includes(role)) {
    redirect('/today');
  }

  const [register, employees] = await Promise.all([getDocumentRegister(), getEmployeeOptions()]);

  // Reuse the loaded register for counts. Missing documents are measured against the active roster.
  const stats = documentStats(
    register,
    employees.map((e) => e.id),
  );

  return <DocumentsScreen register={register} stats={stats} employees={employees} />;
}
