import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { DocumentsScreen } from '@/components/documents/DocumentsScreen';
import { getDocumentRegister } from '@/lib/queries/documents';
import { getEmployeeOptions } from '@/lib/queries/employees';
import { documentStats } from '@/lib/documents/document-summary';
import './documents.css';
import type { AppRole } from '@/types/database';

// Document management is accessible to super_admin/admin/HR.
const documentRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function DocumentsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !documentRoles.includes(role)) {
    redirect('/dashboard');
  }

  const [register, employees] = await Promise.all([getDocumentRegister(), getEmployeeOptions()]);

  // Reuse the loaded register for counts. Missing documents are measured against the active roster.
  const stats = documentStats(
    register,
    employees.map((e) => e.id),
  );

  return <DocumentsScreen register={register} stats={stats} employees={employees} />;
}

export { DocumentsPage as default };
