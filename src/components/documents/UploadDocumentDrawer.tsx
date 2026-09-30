'use client';

// Upload a new document or replace an existing version. Replacements keep the same employee and
// category to preserve the version chain.
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { uploadEmployeeDocument, replaceEmployeeDocument } from '@/lib/actions/documents';
import { documentCategories, documentCategoryLabel } from '@/lib/constants';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import type { EmployeeDocumentRow, EmployeeOption } from '@/lib/server-queries';

interface State {
  ok?: boolean;
  error?: string;
}

type DrawerTarget =
  { mode: 'upload'; employeeId?: string } | { mode: 'replace'; document: EmployeeDocumentRow };

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
  const open = target !== null;
  const replacing = target?.mode === 'replace' ? target.document : null;

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) =>
      replacing
        ? replaceEmployeeDocument(replacing.id, formData)
        : uploadEmployeeDocument(formData),
    {},
  );

  // Keyed on the state object's identity, not on `ok`, so a reopened drawer is
  // not snapped shut by a stale success from the previous submit.
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
        className={`drawer${open ? ' is-active' : ''}`}
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
                    {replacing.name} <span className="text-monospace text-muted">{replacing.code}</span>
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
                <EmployeePicker
                  name="employee_id"
                  employees={employees}
                  required
                  disabled={pending}
                  defaultValue={target?.mode === 'upload' ? (target.employeeId ?? '') : ''}
                />

                <div className="form-field">
                  <label htmlFor="doc-category">Category</label>
                  <select id="doc-category" name="category" defaultValue="offer_letter">
                    {documentCategories.map((c) => (
                      <option key={c} value={c}>
                        {documentCategoryLabel(c)}
                      </option>
                    ))}
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

export { UploadDocumentDrawer, type DrawerTarget };
