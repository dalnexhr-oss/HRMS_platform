'use client';

// Staff-managed onboarding tasks grouped by owner. assignee_role is a display label, not an
// authorization role; employees see read-only progress.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/display-formatting';
import { startOnboarding, setOnboardingTaskStatus, addOnboardingTask, deleteOnboardingTask } from '@/lib/actions/onboarding';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import type { OnboardingTaskRow, OnboardingTemplateRow } from '@/lib/queries/onboarding';
import type { EmployeeOption } from '@/lib/queries/employees';

const roleLabel: Record<string, string> = {
  hr: 'HR',
  it: 'IT',
  admin: 'Admin',
  super_admin: 'Super Admin',
  employee: 'Employee',
};

const statusStyle: Record<string, React.CSSProperties> = {
  pending: {
    borderColor: 'var(--attendance-late-border)',
    color: 'var(--attendance-late)',
    background: 'var(--attendance-late-background)',
  },
  done: {
    borderColor: 'var(--attendance-present-border)',
    color: 'var(--attendance-present)',
    background: 'var(--attendance-present-background)',
  },
  blocked: { borderColor: 'var(--border-strong)', color: 'var(--attendance-half-day)' },
};

function OnboardingScreen({
  tasks,
  templates,
  employees,
}: {
  tasks: OnboardingTaskRow[];
  templates: OnboardingTemplateRow[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showDone, setShowDone] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

  const visible = useMemo(
    () => (showDone ? tasks : tasks.filter((t) => t.status !== 'done')),
    [tasks, showDone],
  );

  // Group by owner so each team sees its own column of work.
  const groups = useMemo(() => {
    const m = new Map<string, OnboardingTaskRow[]>();
    for (const t of visible) {
      const key = t.assigneeRole ?? 'unassigned';
      const list = m.get(key);
      if (list) {
        list.push(t);
      } else {
        m.set(key, [t]);
      }
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const openCount = tasks.filter((t) => t.status !== 'done').length;
  const doneCount = tasks.length - openCount;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        showNotification(res.error ?? 'The action failed.', 'error');
      } else {
        showNotification(okMsg, 'success');
        router.refresh();
      }
    });
  }

  async function onDelete(t: OnboardingTaskRow) {
    const ok = await confirm({
      title: 'Delete task',
      message: `Remove “${t.title}” from ${t.name}'s checklist?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    run(() => deleteOnboardingTask(t.id), 'Task removed.');
  }

  return (
    <div className="content-container grid">
      {confirmDialog}
      {notificationContainer}

      <div className="card">
        <div className="card-header">
          <h3>Start onboarding</h3>
        </div>
        <div className="card-body">
          <StartForm
            employees={employees}
            templates={templates}
            disabled={pending}
            onDone={(res, created) => {
              if (!res.ok) {
                showNotification(res.error ?? 'Could not start onboarding.', 'error');
              } else {
                showNotification(`Checklist created — ${created} step(s).`, 'success');
                router.refresh();
              }
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Onboarding tasks</h3>
          <span className="card-caption">
            {openCount} open{doneCount ? ` · ${doneCount} done` : ''}
          </span>
          <span style={{ flex: 1 }} />
          {doneCount > 0 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => setShowDone(e.target.checked)}
              />
              Show completed
            </label>
          )}
        </div>
        <div className="card-body">
          {groups.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              {tasks.length === 0
                ? 'No onboarding in progress — start one above.'
                : 'Everything is done. Tick “Show completed” to review.'}
            </p>
          ) : (
            groups.map(([role, list]) => (
              <div key={role} style={{ marginBottom: 18 }}>
                <div className="section-heading">
                  {roleLabel[role] ?? role} · {list.length}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Joiner</th>
                        <th>Step</th>
                        <th>Due</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <b>{t.name}</b>{' '}
                            <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                              {t.code}
                            </span>
                          </td>
                          <td>{t.title}</td>
                          <td className="text-monospace">
                            {t.dueDate ? formatDate(t.dueDate) : '—'}
                          </td>
                          <td>
                            <span className="status-badge" style={statusStyle[t.status]}>
                              {t.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {t.status !== 'done' && (
                                <button
                                  className="button quiet"
                                  disabled={pending}
                                  onClick={() =>
                                    run(
                                      () => setOnboardingTaskStatus(t.id, 'done'),
                                      'Step completed.',
                                    )
                                  }
                                >
                                  ✓ Done
                                </button>
                              )}
                              {t.status === 'pending' && (
                                <button
                                  className="button quiet"
                                  disabled={pending}
                                  onClick={() =>
                                    run(
                                      () => setOnboardingTaskStatus(t.id, 'blocked'),
                                      'Step marked blocked.',
                                    )
                                  }
                                  title="Parked — still outstanding, and still chased by the reminder job"
                                >
                                  Block
                                </button>
                              )}
                              {t.status !== 'pending' && (
                                <button
                                  className="button quiet"
                                  disabled={pending}
                                  onClick={() =>
                                    run(
                                      () => setOnboardingTaskStatus(t.id, 'pending'),
                                      'Step reopened.',
                                    )
                                  }
                                >
                                  Reopen
                                </button>
                              )}
                              <button
                                className="button quiet"
                                disabled={pending}
                                onClick={() => onDelete(t)}
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}

          <div className="section-heading">Add a one-off step</div>
          <AddTaskForm
            employees={employees}
            disabled={pending}
            onDone={(res) => {
              if (!res.ok) {
                showNotification(res.error ?? 'Could not add the task.', 'error');
              } else {
                showNotification('Task added.', 'success');
                router.refresh();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Kick off a joiner's checklist from a template. */
function StartForm({
  employees,
  templates,
  disabled,
  onDone,
}: {
  employees: EmployeeOption[];
  templates: OnboardingTemplateRow[];
  disabled: boolean;
  onDone: (res: { ok: boolean; error?: string }, created: number) => void;
}) {
  const active = templates.filter((t) => t.active);
  const [employeeId, setEmployeeId] = useState('');
  const [templateId, setTemplateId] = useState(active[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <EmployeePicker
        employees={employees}
        value={employeeId}
        onChange={setEmployeeId}
        disabled={disabled || busy}
        style={{ flex: '1 1 200px', marginBottom: 0 }}
      />
      <div className="form-field" style={{ flex: '1 1 180px', marginBottom: 0 }}>
        <label>Template</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {active.length === 0 && <option value="">No active template</option>}
          {active.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.steps} steps)
            </option>
          ))}
        </select>
      </div>
      <button
        className="button primary"
        disabled={disabled || busy || !employeeId || !templateId}
        onClick={async () => {
          setBusy(true);
          const res = await startOnboarding(employeeId, templateId);
          setBusy(false);
          if (res.ok) {
            setEmployeeId('');
          }
          onDone(res, res.created ?? 0);
        }}
      >
        {busy ? 'Creating…' : 'Start onboarding'}
      </button>
    </div>
  );
}

/** Add a step a template never predicted. */
function AddTaskForm({
  employees,
  disabled,
  onDone,
}: {
  employees: EmployeeOption[];
  disabled: boolean;
  onDone: (res: { ok: boolean; error?: string }) => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [assigneeRole, setAssigneeRole] = useState('hr');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <EmployeePicker
        employees={employees}
        value={employeeId}
        onChange={setEmployeeId}
        disabled={disabled || busy}
        style={{ flex: '1 1 160px', marginBottom: 0 }}
      />
      <div className="form-field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
        <label>Step</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Order access card"
        />
      </div>
      <div className="form-field" style={{ marginBottom: 0 }}>
        <label>Owner</label>
        <select value={assigneeRole} onChange={(e) => setAssigneeRole(e.target.value)}>
          {Object.entries(roleLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field" style={{ marginBottom: 0 }}>
        <label>Due</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <button
        className="button quiet"
        disabled={disabled || busy || !employeeId || !title.trim()}
        onClick={async () => {
          setBusy(true);
          const res = await addOnboardingTask({ employeeId, title, assigneeRole, dueDate });
          setBusy(false);
          if (res.ok) {
            setTitle('');
          }
          onDone(res);
        }}
      >
        {busy ? '…' : 'Add step'}
      </button>
    </div>
  );
}

export { OnboardingScreen };
