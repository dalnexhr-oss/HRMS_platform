import { getEmployeeContext } from '@/lib/employee-self-service';
import { getEmployeeDocuments } from '@/lib/queries/documents';
import { getDocumentTypes } from '@/lib/queries/document-settings';
import { getExitCases } from '@/lib/queries/exits';
import { MyDocuments } from '@/components/employee/MyDocuments';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// Own document locker: upload what HR asked for and track verification.
async function EmployeeDocumentsPage() {
  const { employeeId } = await getEmployeeContext();
  const [documents, documentTypes, exitCases] = await Promise.all([
    employeeId ? getEmployeeDocuments(employeeId) : [],
    getDocumentTypes(),
    // The employee can read only their own exit case; an open one means they are leaving.
    employeeId ? getExitCases().catch(() => []) : [],
  ]);
  const leaving = exitCases.some((c) => c.employeeId === employeeId && c.stage !== 'completed');

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <MyDocuments
        documents={documents}
        documentTypes={documentTypes}
        leaving={leaving}
        id="documents"
      />
    </div>
  );
}

export { EmployeeDocumentsPage as default };
