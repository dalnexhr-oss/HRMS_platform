import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { ExitsScreen } from '@/components/exits/ExitsScreen';
import { getExitCases } from '@/lib/queries/exits';
import { getEmployeeOptions } from '@/lib/queries/employees';
import { getDocumentTypes } from '@/lib/queries/document-settings';
import type { AppRole } from '@/types/database';

// Match the exit actions' staff role gate.
const exitAdminRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function ExitsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !exitAdminRoles.includes(role)) {
    redirect('/dashboard');
  }

  const [cases, employees, documentTypes] = await Promise.all([
    getExitCases(),
    getEmployeeOptions(),
    getDocumentTypes(),
  ]);
  return <ExitsScreen cases={cases} employees={employees} documentTypes={documentTypes} />;
}

export { ExitsPage as default };
