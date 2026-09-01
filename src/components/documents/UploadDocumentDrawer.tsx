'use client';

// One drawer, two jobs: file a NEW document against an employee, or REPLACE an
// existing one with a newer file.
//
// They share a form because they are the same act from the user's side — "this
// is the current version of X" — and differ only in what the server does with
// the row. Replace deliberately does NOT offer employee or category: a
// replacement is the same document for the same person, and letting either
// change would break the meaning of the version chain behind it.
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { uploadEmployeeDocument, replaceEmployeeDocument } from '@/lib/actions/documents';
import { DOCUMENT_CATEGORIES, documentCategoryLabel } from '@/lib/constants';
import type { EmployeeDocumentRow, EmployeeOption } from '@/lib/queries';

type State = { ok?: boolean; error?: string };

export type DrawerTarget =
  | { mode: 'upload'; employeeId?: string }
  | { mode: 'replace'; document: EmployeeDocumentRow };

export function UploadDocumentDrawer({
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
      replacing ? replaceEmployeeDocument(replacing.id, formData) : uploadEmployeeDocument(formData),
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
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside
        className={`drawer${open ? ' on' : ''}`}
        aria-label={replacing ? 'Replace document' : 'Upload document'}
      >
        {/* Remounts per target, so switching from one row's Replace to
            another's does not keep the first one's field values. */}
        <form
          key={replacing?.id ?? (target?.mode === 'upload' ? target.employeeId ?? 'new' : 'closed')}
          action={formAction}
          style={{ display: 'contents' }}
        >
          <div className="dhd">
            <h3>{replacing ? 'Replace document' : 'Upload a document'}</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn quiet" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="dbd">
            {replacing ? (
              <>
                <div className="f">
                  <label>Employee</label>
                  <div style={{ fontSize: 13, padding: '4px 0' }}>
                    {replacing.name} <span className="mono muted">{replacing.code}</span>
                  </div>
                </div>
                <div className="f">
                  <label>Document</label>
                  <div style={{ fontSize: 13, padding: '4px 0' }}>
                    {documentCategoryLabel(replacing.category)} — {replacing.title ?? 'untitled'}
                    <span className="muted"> · currently v{replacing.version}</span>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  The version on file is kept as history. The replacement goes back to{' '}
                  <b>awaiting verification</b>, whatever the current one’s status.
                </p>
              </>
            ) : (
              <>
                <div className="f">
                  <label htmlFor="doc-employee">Employee</label>
                  <select
                    id="doc-employee"
                    name="employee_id"
                    required
                    defaultValue={target?.mode === 'upload' ? target.employeeId ?? '' : ''}
                  >
                    <option value="">Choose an employee…</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {e.code}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="f">
                  <label htmlFor="doc-category">Category</label>
                  <select id="doc-category" name="category" defaultValue="offer_letter">
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {documentCategoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="f">
              <label htmlFor="doc-title">Title</label>
              <input
                id="doc-title"
                name="title"
                placeholder={replacing ? replacing.title ?? 'Same as before' : 'e.g. PAN card'}
                defaultValue={replacing?.title ?? ''}
              />
            </div>

            <div className="f">
              <label htmlFor="doc-file">File</label>
              <input id="doc-file" type="file" name="file" required />
              <span className="muted" style={{ fontSize: 11 }}>PDF or image, up to 10 MB.</span>
            </div>

            {replacing && (
              <div className="f">
                <label htmlFor="doc-note">Why is it being replaced?</label>
                <input id="doc-note" name="note" placeholder="e.g. Renewed — the old one expired" />
                <span className="muted" style={{ fontSize: 11 }}>
                  Optional. Shown against the new version while it waits for verification.
                </span>
              </div>
            )}

            {state.error && <div className="login-error">{state.error}</div>}
          </div>

          <div className="dft">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? 'Uploading…' : replacing ? 'Replace' : 'Upload'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
