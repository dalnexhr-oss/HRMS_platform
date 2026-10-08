'use client';

// HR's editor for the list of documents employees can be asked for: add one when a new document
// becomes necessary, rename one, say when it is collected, make it compulsory, or stop using it.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveDocumentTypes } from '@/lib/actions/document-settings';
import { documentStages } from '@/lib/document-categories';
import { useDocumentTypes } from './DocumentTypesContext';
import type { DocumentStage, DocumentType } from '@/lib/document-categories';

// A row being edited. New rows have no key until they are saved.
type Row = Omit<DocumentType, 'key'> & { key?: string; rowId: string };

// Plain-language names for when a document is collected.
const whenLabels: Record<DocumentStage, string> = {
  onboarding: 'When someone joins',
  exit: 'When someone leaves',
  other: 'Any time',
};

function DocumentTypesDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const { types } = useDocumentTypes();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Start from the saved list each time the drawer opens.
  useEffect(() => {
    if (open) {
      setRows(types.map((type) => ({ ...type, rowId: type.key })));
      setError(null);
    }
  }, [open, types]);

  const change = (rowId: string, patch: Partial<Row>) =>
    setRows((list) => list.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveDocumentTypes(
        rows.map(({ key, label, stage, required, active }) => ({
          key,
          label,
          stage,
          required,
          active,
        })),
      );
      if (!res.ok) {
        setError(res.error ?? 'The list could not be saved.');
        return;
      }
      onSaved('Document list saved.');
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside className={`drawer is-solid${open ? ' is-active' : ''}`} aria-label="Document list">
        <div className="drawer-header">
          <h3>Document list</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="button quiet" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
            This is the list of documents HR and employees can upload. If a new document becomes
            necessary, for example because of a new government rule, add it here.
          </p>

          {rows.map((row, index) => (
            <div key={row.rowId} className="editor-row">
              <div className="form-field">
                <label htmlFor={`type-name-${row.rowId}`}>Document {index + 1} — name</label>
                <input
                  id={`type-name-${row.rowId}`}
                  value={row.label}
                  maxLength={60}
                  placeholder="e.g. Form 16"
                  onChange={(e) => change(row.rowId, { label: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`type-when-${row.rowId}`}>When is it collected?</label>
                <select
                  id={`type-when-${row.rowId}`}
                  value={row.stage}
                  onChange={(e) => change(row.rowId, { stage: e.target.value as DocumentStage })}
                >
                  {documentStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {whenLabels[stage]}
                    </option>
                  ))}
                </select>
              </div>
              <label className="editor-check">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(e) => change(row.rowId, { required: e.target.checked })}
                />
                <span>
                  <b>Compulsory</b> — show it as missing until HR has checked the employee’s copy
                </span>
              </label>
              <label className="editor-check">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => change(row.rowId, { active: e.target.checked })}
                />
                <span>
                  <b>Still in use</b> — untick to stop offering it; copies already uploaded are kept
                </span>
              </label>
              {/* A saved document may already have copies on file, so it is switched off, not removed. */}
              {!row.key && (
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => setRows((list) => list.filter((r) => r.rowId !== row.rowId))}
                >
                  Remove this one
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="button"
            style={{ marginTop: 14 }}
            onClick={() =>
              setRows((list) => [
                ...list,
                {
                  rowId: `new-${Date.now()}-${list.length}`,
                  label: '',
                  stage: 'onboarding',
                  required: false,
                  active: true,
                },
              ])
            }
          >
            + Add a document
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
            {pending ? 'Saving…' : 'Save list'}
          </button>
        </div>
      </aside>
    </>
  );
}

export { DocumentTypesDrawer };
