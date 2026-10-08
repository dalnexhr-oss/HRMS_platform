'use client';

// Create or edit an onboarding checklist template: its name, whether it is in use, and its steps
// in order, each with the team that does it.
import { useEffect, useState, useTransition } from 'react';
import { saveOnboardingTemplate } from '@/lib/actions/onboarding';
import type { OnboardingTemplateRow } from '@/lib/queries/onboarding';

interface Step {
  rowId: string;
  title: string;
  assigneeRole: string;
}

const ownerOptions: Array<[string, string]> = [
  ['hr', 'HR'],
  ['it', 'IT'],
  ['admin', 'Admin'],
  ['employee', 'Employee'],
  ['', 'Nobody in particular'],
];

let nextRowId = 0;
const newStep = (title = '', assigneeRole = 'hr'): Step => ({
  rowId: `step-${nextRowId++}`,
  title,
  assigneeRole,
});

function OnboardingTemplateDrawer({
  target,
  onClose,
  onSaved,
}: {
  // 'new' for a blank template, a template to edit it, or null when closed.
  target: OnboardingTemplateRow | 'new' | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const open = target !== null;
  const editing = target !== null && target !== 'new' ? target : null;
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Load the template each time the drawer opens.
  useEffect(() => {
    if (target === null) {
      return;
    }
    setName(target === 'new' ? '' : target.name);
    setActive(target === 'new' ? true : target.active);
    setSteps(
      target === 'new' || target.items.length === 0
        ? [newStep()]
        : target.items.map((item) => newStep(item.title, item.assigneeRole ?? '')),
    );
    setError(null);
  }, [target]);

  const change = (rowId: string, patch: Partial<Step>) =>
    setSteps((list) => list.map((step) => (step.rowId === rowId ? { ...step, ...patch } : step)));

  function move(index: number, by: -1 | 1) {
    setSteps((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) {
        return list;
      }
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveOnboardingTemplate({
        id: editing?.id,
        name,
        active,
        items: steps.map((step) => ({
          title: step.title,
          assigneeRole: step.assigneeRole || null,
        })),
      });
      if (!res.ok) {
        setError(res.error ?? 'The template could not be saved.');
        return;
      }
      onSaved(editing ? 'Template updated.' : 'Template created.');
      onClose();
    });
  }

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside
        className={`drawer is-solid${open ? ' is-active' : ''}`}
        aria-label="Onboarding template"
      >
        <div className="drawer-header">
          <h3>{editing ? 'Edit template' : 'New template'}</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="button quiet" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="form-field">
            <label htmlFor="template-name">Template name</label>
            <input
              id="template-name"
              value={name}
              maxLength={80}
              placeholder="e.g. Standard joiner"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <label className="editor-check" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>
              <b>In use</b> — can be picked when starting onboarding for a new joiner
            </span>
          </label>

          <div className="form-field" style={{ marginBottom: 6 }}>
            <label>Steps, in the order they are done</label>
          </div>
          {steps.map((step, index) => (
            <div key={step.rowId} className="editor-row">
              <div className="form-field">
                <label htmlFor={`step-title-${step.rowId}`}>
                  Step {index + 1} — what has to be done
                </label>
                <input
                  id={`step-title-${step.rowId}`}
                  value={step.title}
                  maxLength={200}
                  placeholder="e.g. Collect signed offer letter"
                  onChange={(e) => change(step.rowId, { title: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`step-owner-${step.rowId}`}>Who does it?</label>
                <select
                  id={`step-owner-${step.rowId}`}
                  value={step.assigneeRole}
                  onChange={(e) => change(step.rowId, { assigneeRole: e.target.value })}
                >
                  {ownerOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="editor-row-actions">
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  ↑ Move up
                </button>
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                >
                  ↓ Move down
                </button>
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => setSteps((list) => list.filter((s) => s.rowId !== step.rowId))}
                  disabled={steps.length === 1}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="button"
            onClick={() => setSteps((list) => [...list, newStep()])}
          >
            + Add step
          </button>

          {error && (
            <div className="error-message" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button type="button" className="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save template' : 'Create template'}
          </button>
        </div>
      </aside>
    </>
  );
}

export { OnboardingTemplateDrawer };
