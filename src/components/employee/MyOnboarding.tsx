// Read-only onboarding progress. Staff complete tasks so done_by and done_at record the responsible
// person.
import { formatDate } from '@/lib/format';
import type { OnboardingTaskRow } from '@/lib/queries';

const ownerLabel: Record<string, string> = {
  hr: 'HR',
  it: 'IT',
  admin: 'Admin',
  super_admin: 'Super Admin',
  employee: 'You',
  intern: 'You',
};

export function MyOnboarding({ tasks, id }: { tasks: OnboardingTaskRow[]; id?: string }) {
  if (tasks.length === 0) {
    // nothing in flight — don't show an empty card
    return null;
  }

  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.length - open.length;
  const mine = open.filter((t) => t.assigneeRole === 'employee');

  return (
    <div className="card" id={id}>
      <div className="hd">
        <h3>Your onboarding</h3>
        <span className="folio">
          {done}/{tasks.length} complete
        </span>
      </div>
      <div className="bd">
        {mine.length > 0 && (
          <div className="hint" style={{ marginBottom: 12 }}>
            <b>
              {mine.length} step{mine.length === 1 ? '' : 's'} need you:
            </b>{' '}
            {mine.map((t) => t.title).join(' · ')}
          </div>
        )}

        {open.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Everything is done — welcome aboard.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>With</th>
                  <th>By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {open.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.assigneeRole ? (ownerLabel[t.assigneeRole] ?? t.assigneeRole) : '—'}</td>
                    <td className="mono">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                    <td>
                      <span
                        className="pill"
                        style={
                          t.status === 'blocked'
                            ? { borderColor: 'var(--line-2)', color: 'var(--hd)' }
                            : {
                                borderColor: 'var(--lm-line)',
                                color: 'var(--lm)',
                                background: 'var(--lm-bg)',
                              }
                        }
                      >
                        {t.status}
                      </span>
                    </td>
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
