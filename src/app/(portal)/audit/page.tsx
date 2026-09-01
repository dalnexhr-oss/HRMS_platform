import { redirect } from 'next/navigation';
import { getAttendanceAudit } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { AppRole } from '@/types/database';

// Attendance audit trail is staff-only (admin/HR) — the same set that
// may write attendance. Others are bounced; the nav link is hidden via NAV_ROLE_GATED.
const AUDIT_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

const EVENT_LABEL: Record<string, string> = {
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

export default async function AuditPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !AUDIT_ROLES.includes(role)) redirect('/today');

  let entries: Awaited<ReturnType<typeof getAttendanceAudit>> = [];
  let loadError: string | null = null;
  try {
    entries = await getAttendanceAudit();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="wrap">
      <div className="card">
        <div className="hd">
          <h3>Attendance audit</h3>
          <span className="folio">{entries.length} recent event{entries.length === 1 ? '' : 's'}</span>
        </div>
        {loadError ? (
          <div className="bd">
            <div className="login-error">Could not load the audit log: {loadError}</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>No attendance edits recorded yet.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>By</th>
                  <th>Employee</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>{stampTime(e.occurredAt)}</td>
                    <td>
                      <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
                        {EVENT_LABEL[e.eventType] ?? e.eventType}
                      </span>
                    </td>
                    <td>{e.actor ?? <span className="muted">system</span>}</td>
                    <td>
                      {e.employeeName ? (
                        <>
                          {e.employeeName}{' '}
                          <span className="mono muted" style={{ fontSize: 11 }}>{e.employeeCode}</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {/* Rendered as text by React — activity_log messages are never HTML. */}
                    <td style={{ fontSize: 13 }}>{e.message}</td>
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
