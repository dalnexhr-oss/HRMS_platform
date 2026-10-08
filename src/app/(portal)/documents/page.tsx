import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { DocumentsScreen } from '@/components/documents/DocumentsScreen';
import { getDocumentRegister } from '@/lib/queries/documents';
import { getDocumentTypes } from '@/lib/queries/document-settings';
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

  const [register, employees, documentTypes] = await Promise.all([
    getDocumentRegister(),
    getEmployeeOptions(),
    getDocumentTypes(),
  ]);

  // Reuse the loaded register for counts. Missing documents are measured against the roster and
  // HR's required types; exit documents count only for someone serving notice.
  const stats = documentStats(
    register,
    employees.map((e) => ({ id: e.id, leaving: e.status === 'on_notice' })),
    documentTypes,
  );

  return (
    <DocumentsScreen
      register={register}
      stats={stats}
      employees={employees}
      documentTypes={documentTypes}
    />
  );
}

export { DocumentsPage as default };
