'use client';

// Upload a new document or replace an existing version. Replacements keep the same employee and
// category to preserve the version chain.
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadEmployeeDocument, replaceEmployeeDocument } from '@/lib/actions/documents';
import { documentStageLabels, documentStages } from '@/lib/document-categories';
import { useDocumentTypes } from './DocumentTypesContext';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import type { DocumentStage } from '@/lib/document-categories';
import type { EmployeeDocumentRow } from '@/lib/documents/document-summary';
import type { EmployeeOption } from '@/lib/queries/employees';

interface State {
  ok?: boolean;
  error?: string;
}

type DrawerTarget =
  | { mode: 'upload'; employeeId?: string; stage?: DocumentStage }
  | { mode: 'replace'; document: EmployeeDocumentRow };

function UploadDocumentDrawer({
  target,
  employees,
  onClose,
}: {
  target: DrawerTarget | null;
  employees: EmployeeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { activeTypes, label: documentCategoryLabel } = useDocumentTypes();
  const open = target !== null;
  // Start on a type from the stage the caller asked for, when it has one.
  const preferredStage = target?.mode === 'upload' ? target.stage : undefined;
  const defaultType =
    activeTypes.find((type) => type.stage === preferredStage)?.key ?? activeTypes[0]?.key;
  const replacing = target?.mode === 'replace' ? target.document : null;

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) =>
      replacing
        ? replaceEmployeeDocument(replacing.id, formData)
        : uploadEmployeeDocument(formData),
    {},
  );

  // Automatically close the drawer and refresh the document list once an upload succeeds.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (state.ok) {
      onCloseRef.current();
      router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside
        className={`drawer is-solid${open ? ' is-active' : ''}`}
        aria-label={replacing ? 'Replace document' : 'Upload document'}
      >
        {/* Remounts per target, so switching from one row's Replace to
            another's does not keep the first one's field values. */}
        <form
          key={
            replacing?.id ?? (target?.mode === 'upload' ? (target.employeeId ?? 'new') : 'closed')
          }
          action={formAction}
          style={{ display: 'contents' }}
        >
          <div className="drawer-header">
            <h3>{replacing ? 'Replace document' : 'Upload a document'}</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="button quiet" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="drawer-body">
            {replacing ? (
              <>
                <div className="form-field">
                  <label>Employee</label>
                  <div style={{ fontSize: 13, padding: '4px 0' }}>
                    {replacing.name}{' '}
                    <span className="text-monospace text-muted">{replacing.code}</span>
                  </div>
                </div>
                <div className="form-field">
                  <label>Document</label>
                  <div style={{ fontSize: 13, padding: '4px 0' }}>
                    {documentCategoryLabel(replacing.category)} — {replacing.title ?? 'untitled'}
                    <span className="text-muted"> · currently v{replacing.version}</span>
                  </div>
                </div>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
                  The version on file is kept as history. The replacement goes back to{' '}
                  <b>awaiting verification</b>, whatever the current one’s status.
                </p>
              </>
            ) : (
              <>
                <RecipientsField
                  employees={employees}
                  disabled={pending}
                  defaultEmployeeId={target?.mode === 'upload' ? (target.employeeId ?? '') : ''}
                />

                <div className="form-field">
                  <label htmlFor="doc-category">Category</label>
                  <select id="doc-category" name="category" defaultValue={defaultType}>
                    {documentStages.map((stage) => {
                      const inStage = activeTypes.filter((type) => type.stage === stage);
                      return inStage.length === 0 ? null : (
                        <optgroup key={stage} label={documentStageLabels[stage]}>
                          {inStage.map((type) => (
                            <option key={type.key} value={type.key}>
                              {type.label}
                              {type.required ? ' (required)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              </>
            )}

            <div className="form-field">
              <label htmlFor="doc-title">Title</label>
              <input
                id="doc-title"
                name="title"
                placeholder={replacing ? (replacing.title ?? 'Same as before') : 'e.g. PAN card'}
                defaultValue={replacing?.title ?? ''}
              />
            </div>

            <div className="form-field">
              <label htmlFor="doc-file">File</label>
              <input id="doc-file" type="file" name="file" required />
              <span className="text-muted" style={{ fontSize: 11 }}>
                PDF or image, up to 10 MB.
              </span>
            </div>

            {!replacing && (
              <label className="editor-check" style={{ marginBottom: 15 }}>
                <input type="checkbox" name="needs_signature" />
                <span>
                  <b>The employee has to sign this and send it back</b> — they will be asked to
                  download it, sign it and upload the signed copy. The file must be a PDF.
                </span>
              </label>
            )}

            {replacing && (
              <div className="form-field">
                <label htmlFor="doc-note">Why is it being replaced?</label>
                <input id="doc-note" name="note" placeholder="e.g. Renewed — the old one expired" />
                <span className="text-muted" style={{ fontSize: 11 }}>
                  Optional. Shown against the new version while it waits for verification.
                </span>
              </div>
            )}

            {state.error && <div className="error-message">{state.error}</div>}
          </div>

          <div className="drawer-footer">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={pending}>
              {pending ? 'Uploading…' : replacing ? 'Replace' : 'Upload'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

type Audience = 'one' | 'some' | 'all';

const audienceLabels: Array<[Audience, string]> = [
  ['one', 'One employee'],
  ['some', 'Several employees'],
  ['all', 'All employees'],
];

// Who the document is for. The same file can go to one person, a chosen group, or everyone; each
// employee gets their own copy on their own record.
function RecipientsField({
  employees,
  disabled,
  defaultEmployeeId,
}: {
  employees: EmployeeOption[];
  disabled: boolean;
  defaultEmployeeId: string;
}) {
  const [audience, setAudience] = useState<Audience>('one');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const matches = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return term
      ? employees.filter((e) => `${e.name} ${e.code}`.toLowerCase().includes(term))
      : employees;
  }, [employees, searchQuery]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <>
      <div className="form-field">
        <label>Who is this document for?</label>
        <div className="recipient-choices">
          {audienceLabels.map(([value, label]) => (
            <label key={value} className="editor-check" style={{ marginTop: 0 }}>
              <input
                type="radio"
                name="audience"
                value={value}
                checked={audience === value}
                disabled={disabled}
                onChange={() => setAudience(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {audience === 'one' && (
        <EmployeePicker
          name="employee_id"
          employees={employees}
          required
          disabled={disabled}
          defaultValue={defaultEmployeeId}
        />
      )}

      {audience === 'some' && (
        <div className="form-field">
          <label htmlFor="recipient-search">Tick the employees — {selected.size} chosen</label>
          <input
            id="recipient-search"
            type="search"
            placeholder="Search by name or code…"
            value={searchQuery}
            disabled={disabled}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="recipient-list">
            {matches.length === 0 && <p className="text-muted">No employee matches that search.</p>}
            {matches.map((employee) => (
              <label key={employee.id} className="editor-check">
                <input
                  type="checkbox"
                  checked={selected.has(employee.id)}
                  disabled={disabled}
                  onChange={() => toggle(employee.id)}
                />
                <span>
                  {employee.name} <span className="text-monospace text-muted">{employee.code}</span>
                </span>
              </label>
            ))}
          </div>
          {/* Sent from the chosen set, so people hidden by the search are still included. */}
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="employee_ids" value={id} />
          ))}
        </div>
      )}

      {audience === 'all' && (
        <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
          Every current employee ({employees.length}) will get their own copy of this document on
          their record.
        </p>
      )}
    </>
  );
}

export { UploadDocumentDrawer, type DrawerTarget };
