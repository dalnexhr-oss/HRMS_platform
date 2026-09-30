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
    <div className="wrap">
      <div className="card audit-card">
        <div className="hd">
          <h3 className="audit-title">
          <span aria-hidden="true" style={{ marginRight: '0.5em' }}>{icons.recent}</span>
            {entries.length} recent event{entries.length === 1 ? '' : 's'}
          
          </h3>
        </div>
        {loadError ? (
          <div className="bd">
            <div className="login-error">Could not load the audit log: {loadError}</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>
              No attendance edits recorded yet.
            </p>
          </div>
        ) : (
          <div className="audit-scroll" role="region" aria-label="Attendance audit log" tabIndex={0}>
            <table className="audit-table sticky-th">
              <colgroup>
                <col className="audit-col-when" />
                <col className="audit-col-type" />
                <col className="audit-col-actor" />
                <col className="audit-col-employee" />
                <col className="audit-col-detail" />
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
                    <td className="mono muted">
                      {stampTime(e.occurredAt)}
                    </td>
                    <td>
                      <span
                        className="pill"
                        style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}
                      >
                        {eventLabel[e.eventType] ?? e.eventType}
                      </span>
                    </td>
                    <td>{e.actor ?? <span className="muted">system</span>}</td>
                    <td>
                      {e.employeeName ? (
                        <>
                          {e.employeeName}
                          <span className="mono muted audit-employee-code">
                            {e.employeeCode}
                          </span>
                        </>
                      ) : (
                        <span className="muted">—</span>
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
