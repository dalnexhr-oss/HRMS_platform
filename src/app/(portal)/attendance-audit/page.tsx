import { getSession } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { redirect } from 'next/navigation';
import { getAttendanceAudit } from '@/lib/queries';
import { icons } from '@/components/Icons';
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
      <div className="card audit-card">
        <div className="card-header">
          <h3 className="audit-title">
          <span aria-hidden="true" style={{ marginRight: '0.5em' }}>{icons.recent}</span>
            {entries.length} recent event{entries.length === 1 ? '' : 's'}
          
          </h3>
        </div>
        {loadError ? (
          <div className="card-body">
            <div className="error-message">Could not load the audit log: {loadError}</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="card-body">
            <p className="text-muted" style={{ margin: 0 }}>
              No attendance edits recorded yet.
            </p>
          </div>
        ) : (
          <div className="audit-scroll" role="region" aria-label="Attendance audit log" tabIndex={0}>
            <table className="audit-table sticky-table-header">
              <colgroup>
                <col className="audit-column-when" />
                <col className="audit-column-type" />
                <col className="audit-column-actor" />
                <col className="audit-column-employee" />
                <col className="audit-column-detail" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  <th scope="col">By</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="text-monospace text-muted">
                      {stampTime(e.occurredAt)}
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                      >
                        {eventLabel[e.eventType] ?? e.eventType}
                      </span>
                    </td>
                    <td>{e.actor ?? <span className="text-muted">system</span>}</td>
                    <td>
                      {e.employeeName ? (
                        <>
                          {e.employeeName}
                          <span className="text-monospace text-muted audit-employee-code">
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
