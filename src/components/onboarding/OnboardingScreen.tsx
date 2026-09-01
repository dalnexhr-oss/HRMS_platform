'use client';

// The onboarding board: start a joiner's checklist from a template, then work
// the task group by owner (HR, IT, Admin, etc). Every action is a staff action; the joiner sees only the read-only MyOnboarding card on their dashboard.
//
// "assignee_role" is a free-text OWNER label, not an app role — 'it' and
// 'employee' own steps without being portal roles (see the 0037 column comment).
// So the grouping here is presentational; every tick is a staff action.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import {
  startOnboarding,
  setOnboardingTaskStatus,
  addOnboardingTask,
  deleteOnboardingTask,
} from '@/lib/actions/onboarding';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type {
  OnboardingTaskRow,
  OnboardingTemplateRow,
  EmployeeOption,
} from '@/lib/queries';

const ROLE_LABEL: Record<string, string> = {
  hr: 'HR',
  it: 'IT',
  admin: 'Admin',
  super_admin: 'Super Admin',
  employee: 'Employee',
};

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  pending: { borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' },
  done: { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' },
  blocked: { borderColor: 'var(--line-2)', color: 'var(--hd)' },
};

export function OnboardingScreen({
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
  const { toast, toastNode } = useToast();

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
      if (list) list.push(t);
      else m.set(key, [t]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const openCount = tasks.filter((t) => t.status !== 'done').length;
  const doneCount = tasks.length - openCount;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast(res.error ?? 'The action failed.', 'error');
      else {
        toast(okMsg, 'success');
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
    if (!ok) return;
    run(() => deleteOnboardingTask(t.id), 'Task removed.');
  }

  return (
    <div className="wrap grid">
      {confirmDialog}
      {toastNode}

      <div className="card">
        <div className="hd">
          <h3>Start onboarding</h3>
        </div>
        <div className="bd">
          <StartForm
            employees={employees}
            templates={templates}
            disabled={pending}
            onDone={(res, created) => {
              if (!res.ok) toast(res.error ?? 'Could not start onboarding.', 'error');
              else {
                toast(`Checklist created — ${created} step(s).`, 'success');
                router.refresh();
              }
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Onboarding tasks</h3>
          <span className="folio">
            {openCount} open{doneCount ? ` · ${doneCount} done` : ''}
          </span>
          <span style={{ flex: 1 }} />
          {doneCount > 0 && (
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}
            >
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              Show completed
            </label>
          )}
        </div>
        <div className="bd">
          {groups.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {tasks.length === 0
                ? 'No onboarding in progress — start one above.'
                : 'Everything is done. Tick “Show completed” to review.'}
            </p>
          ) : (
            groups.map(([role, list]) => (
              <div key={role} style={{ marginBottom: 18 }}>
                <div className="fold">
                  {ROLE_LABEL[role] ?? role} · {list.length}
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
                            <span className="mono muted" style={{ fontSize: 11 }}>{t.code}</span>
                          </td>
                          <td>{t.title}</td>
                          <td className="mono">{t.dueDate ? formatDate(t.dueDate) : '—'}</td>
                          <td>
                            <span className="pill" style={STATUS_STYLE[t.status]}>
                              {t.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {t.status !== 'done' && (
                                <button
                                  className="btn quiet"
                                  disabled={pending}
                                  onClick={() => run(() => setOnboardingTaskStatus(t.id, 'done'), 'Step completed.')}
                                >
                                  ✓ Done
                                </button>
                              )}
                              {t.status === 'pending' && (
                                <button
                                  className="btn quiet"
                                  disabled={pending}
                                  onClick={() => run(() => setOnboardingTaskStatus(t.id, 'blocked'), 'Step marked blocked.')}
                                  title="Parked — still outstanding, and still chased by the reminder job"
                                >
                                  Block
                                </button>
                              )}
                              {t.status !== 'pending' && (
                                <button
                                  className="btn quiet"
                                  disabled={pending}
                                  onClick={() => run(() => setOnboardingTaskStatus(t.id, 'pending'), 'Step reopened.')}
                                >
                                  Reopen
                                </button>
                              )}
                              <button className="btn quiet" disabled={pending} onClick={() => onDelete(t)}>
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

          <div className="fold">Add a one-off step</div>
          <AddTaskForm
            employees={employees}
            disabled={pending}
            onDone={(res) => {
              if (!res.ok) toast(res.error ?? 'Could not add the task.', 'error');
              else {
                toast('Task added.', 'success');
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
      <div className="f" style={{ flex: '1 1 200px', marginBottom: 0 }}>
        <label>Employee</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose a joiner…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
          ))}
        </select>
      </div>
      <div className="f" style={{ flex: '1 1 180px', marginBottom: 0 }}>
        <label>Template</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {active.length === 0 && <option value="">No active template</option>}
          {active.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.steps} steps)</option>
          ))}
        </select>
      </div>
      <button
        className="btn primary"
        disabled={disabled || busy || !employeeId || !templateId}
        onClick={async () => {
          setBusy(true);
          const res = await startOnboarding(employeeId, templateId);
          setBusy(false);
          if (res.ok) setEmployeeId('');
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
      <div className="f" style={{ flex: '1 1 160px', marginBottom: 0 }}>
        <label>Employee</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
          ))}
        </select>
      </div>
      <div className="f" style={{ flex: '1 1 200px', marginBottom: 0 }}>
        <label>Step</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Order access card" />
      </div>
      <div className="f" style={{ marginBottom: 0 }}>
        <label>Owner</label>
        <select value={assigneeRole} onChange={(e) => setAssigneeRole(e.target.value)}>
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="f" style={{ marginBottom: 0 }}>
        <label>Due</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <button
        className="btn quiet"
        disabled={disabled || busy || !employeeId || !title.trim()}
        onClick={async () => {
          setBusy(true);
          const res = await addOnboardingTask({ employeeId, title, assigneeRole, dueDate });
          setBusy(false);
          if (res.ok) setTitle('');
          onDone(res);
        }}
      >
        {busy ? '…' : 'Add step'}
      </button>
    </div>
  );
}
