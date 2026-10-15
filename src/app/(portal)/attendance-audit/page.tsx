import { getSession } from '@/lib/server-auth';
import { AuditScreen } from '@/components/attendance-audit/AuditScreen';
import { redirect } from 'next/navigation';
import { getAttendanceAudit } from '@/lib/queries/attendance';
import './attendance-audit.css';
import type { AppRole } from '@/types/database';

// Attendance audit trail is staff-only (super_admin/admin/HR)
const auditRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function AuditPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !auditRoles.includes(role)) {
    redirect('/dashboard');
  }

  let entries: Awaited<ReturnType<typeof getAttendanceAudit>> = [];
  let loadError: string | null = null;
  try {
    entries = await getAttendanceAudit();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return <AuditScreen entries={entries} loadError={loadError} />;
}

export { AuditPage as default };
