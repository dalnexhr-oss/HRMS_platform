// Read-only onboarding progress. Staff complete tasks so done_by and done_at record the responsible
// person.
import { formatDate } from '@/lib/display-formatting';
import type { OnboardingTaskRow } from '@/lib/queries/onboarding';

const ownerLabel: Record<string, string> = {
  hr: 'HR',
  it: 'IT',
  admin: 'Admin',
  super_admin: 'Super Admin',
  employee: 'You',
  intern: 'You',
};

function MyOnboarding({ tasks, id }: { tasks: OnboardingTaskRow[]; id?: string }) {
  if (tasks.length === 0) {
    // nothing in flight — don't show an empty card
    return null;
  }

  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.length - open.length;
  const mine = open.filter((t) => t.assigneeRole === 'employee');

  return (
    <div className="card" id={id}>
      <div className="card-header">
        <h3>Your onboarding</h3>
        <span className="card-caption">
          {done}/{tasks.length} complete
        </span>
      </div>
      <div className="card-body">
        {mine.length > 0 && (
          <div className="hint" style={{ marginBottom: 12 }}>
            <b>
              {mine.length} step{mine.length === 1 ? '' : 's'} need you:
            </b>{' '}
            {mine.map((t) => t.title).join(' · ')}
          </div>
        )}

        {open.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>
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
                    <td className="text-monospace">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                    <td>
                      <span
                        className="status-badge"
                        style={
                          t.status === 'blocked'
                            ? {
                                borderColor: 'var(--border-strong)',
                                color: 'var(--attendance-half-day)',
                              }
                            : {
                                borderColor: 'var(--attendance-late-border)',
                                color: 'var(--attendance-late)',
                                background: 'var(--attendance-late-background)',
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

export { MyOnboarding };
