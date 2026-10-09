import { getSession } from '@/lib/server-auth';
import { formatDate } from '@/lib/display-formatting';
import { redirect } from 'next/navigation';
import { getAttendanceAudit } from '@/lib/queries/attendance';
import { icons } from '@/components/Icons';
import tableStyles from '@/components/ui/RecordTable.module.css';
import './audit.css';
import type { AppRole } from '@/types/database';

// Attendance audit trail is staff-only (super_admin/admin/HR)
const auditRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

const eventLabel: Record<string, string> = {
  attendance_correction: 'Correction',
  register_import: 'Import',
  night_sweep: 'Auto punch-out',
};

function stampTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : `${formatDate(iso.slice(0, 10))} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

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

  return (
    <div className="content-container">
      <div className={`card ${tableStyles.panel}`}>
        <div className={tableStyles.header}>
          <div className={tableStyles.heading}>
            <h3 className="audit-title">
              <span aria-hidden="true">{icons.recent}</span>
              <span>Recent attendance activity ({entries.length})</span>
            </h3>
          </div>
        </div>
        {loadError ? (
          <div className="card-body">
            <div className="error-message">Could not load the audit log: {loadError}</div>
          </div>
        ) : entries.length === 0 ? (
          <p className={tableStyles.empty}>No attendance edits recorded yet.</p>
        ) : (
          <div
            className={`${tableStyles.scroll} audit-scroll`}
            role="region"
            aria-label="Attendance audit log"
            tabIndex={0}
          >
            <table className={`${tableStyles.table} audit-table`} aria-label="Attendance events">
              <colgroup>
                <col className="audit-column-when" />
                <col className="audit-column-type" />
                <col className="audit-column-actor" />
                <col className="audit-column-employee" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Date &amp; time</th>
                  <th scope="col">Type</th>
                  <th scope="col">Changed by</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className={`text-monospace text-muted ${tableStyles.nowrap}`}>
                      {stampTime(e.occurredAt)}
                    </td>
                    <td>
                      <span className="status-badge audit-event-type">
                        {eventLabel[e.eventType] ?? e.eventType}
                      </span>
                    </td>
                    <td>{e.actor ?? <span className="text-muted">System</span>}</td>
                    <td>
                      {e.employeeName ? (
                        <>
                          <span className={tableStyles.employeeName}>{e.employeeName}</span>
                          <span className={`text-monospace ${tableStyles.identityDetails}`}>
                            {e.employeeCode}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {/* Rendered as text by React — activity_log messages are never HTML. */}
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export { AuditPage as default };
