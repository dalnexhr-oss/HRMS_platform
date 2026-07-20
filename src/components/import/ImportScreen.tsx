'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { previewImport, commitImport } from '@/lib/actions/import';
import type { CommitResult, ImportPreview, PreviewResult } from '@/lib/actions/import';
import type { AppRole } from '@/types/database';

/** '2026-06-01' -> 'June 2026'. */
function monthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

const AMBER = '#9a6b00';
const AMBER_LINE = '#e6c877';
const AMBER_BG = '#fdf6e3';

export function ImportScreen({
  canImport,
  configured,
  role,
}: {
  canImport: boolean;
  configured: boolean;
  role: AppRole | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [committing, startCommit] = useTransition();

  const [state, previewAction, previewing] = useActionState<PreviewResult | null, FormData>(
    async (_prev, formData) => previewImport(formData),
    null,
  );

  const preview: ImportPreview | null = state?.ok ? state.preview : null;
  const previewError = state && !state.ok ? state.error : null;

  // `!previewing` matters: useActionState holds the PREVIOUS state while the
  // next action is in flight. Without it, submitting a second file flips
  // straight to the first file's preview — stale numbers presented as if they
  // described the new upload, and no loading feedback at all. Staying on the
  // upload step keeps the "Reading the sheet…" button visible until the fresh
  // preview actually lands.
  const step: 'upload' | 'preview' | 'done' =
    result !== null ? 'done' : preview && !cancelled && !previewing ? 'preview' : 'upload';

  function reset() {
    setCancelled(true);
    setFile(null);
    setResult(null);
    formRef.current?.reset();
  }

  function onCommit() {
    if (!file) return;
    // The file is re-uploaded and re-parsed by commitImport (it re-resolves the
    // roster so the write reflects current employees, not a stale preview). For a
    // static monthly sheet this is correct; the cost is one extra parse.
    const fd = new FormData();
    fd.append('file', file);
    startCommit(async () => {
      setResult(await commitImport(fd));
    });
  }

  // The single reason the Import button cannot run, or null if it can. Drives
  // both the disabled state and its tooltip, so the two can never disagree.
  function blockedReason(p: ImportPreview): string | null {
    if (!configured)
      return 'Supabase is not connected, so there is nowhere to write. Nothing can be imported in demo mode.';
    if (!canImport)
      return `Importing the register needs an admin, HR or manager account${
        role ? ` — yours is “${role}”.` : '.'
      }`;
    if (!file) return 'Choose the register file again before importing.';
    if (p.totalRows === 0)
      return 'No rows in this sheet could be matched to an employee, so there is nothing to write.';
    return null;
  }

  return (
    <div className="wrap grid">
      {!configured ? (
        <div className="card" style={{ borderColor: AMBER_LINE, background: AMBER_BG }}>
          <div className="hd">
            <h3 style={{ color: AMBER }}>Demo mode — importing is disabled</h3>
          </div>
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>
              Supabase is not connected, so there is no database to write attendance to. You can
              still upload a file to check that it parses, but the matched names below are demo
              records, not your staff, and the import button stays disabled.
            </p>
          </div>
        </div>
      ) : (
        !canImport && (
          <div className="card" style={{ borderColor: AMBER_LINE, background: AMBER_BG }}>
            <div className="hd">
              <h3 style={{ color: AMBER }}>Read-only access</h3>
            </div>
            <div className="bd">
              <p className="muted" style={{ margin: 0 }}>
                Importing the register needs an admin, HR or manager account
                {role ? ` — yours is “${role}”.` : '.'} You can still upload a file to preview what
                it contains; the import button is disabled.
              </p>
            </div>
          </div>
        )
      )}

      {step === 'upload' && (
        <div className="card">
          <div className="hd">
            <h3>Upload monthly register</h3>
            <span className="folio">.xlsx · from the attendance sheet</span>
          </div>
          <div className="bd">
            <form
              ref={formRef}
              action={previewAction}
              onSubmit={() => {
                setCancelled(false);
                setResult(null);
              }}
            >
              <div className="f">
                <label htmlFor="register-file">Monthly register file</label>
                <input
                  id="register-file"
                  name="file"
                  type="file"
                  // .xlsx only: exceljs reads the OOXML zip format, not the
                  // legacy BIFF .xls. Offering .xls here would accept a file
                  // that can only fail with "could not be opened as an .xlsx".
                  accept=".xlsx"
                  required
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setCancelled(false);
                    setResult(null);
                  }}
                />
                <span className="hint">
                  The sheet is read exactly as laid out: month from B2, day columns across row 4,
                  one four-row block per employee from row 6. Nothing is written until you confirm
                  the preview.
                </span>
              </div>

              {previewError && <div className="login-error">{previewError}</div>}

              <button className="btn primary" type="submit" disabled={previewing || !file}>
                {previewing ? 'Reading the sheet…' : 'Preview import'}
              </button>
            </form>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="card">
            <div className="hd">
              <h3>{monthLabel(preview.periodMonth)}</h3>
              <span className="folio">
                {preview.daysInMonth} days · {preview.matched.length} employee
                {preview.matched.length === 1 ? '' : 's'} matched · {preview.totalRows} row
                {preview.totalRows === 1 ? '' : 's'} to write
              </span>
              <span style={{ flex: 1 }} />
              <span className="pill">Preview only — nothing saved yet</span>
            </div>

            {preview.matched.length === 0 ? (
              <div className="bd">
                <p className="empty">
                  No employee in this sheet could be matched to a record in the system.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Days parsed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.matched.map((m) => (
                      <tr key={m.code}>
                        <td className="mono muted">{m.code}</td>
                        <td>
                          <b>{m.name}</b>
                        </td>
                        <td className="mono">{m.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(preview.unmatched.length > 0 || preview.warnings.length > 0) && (
            <div className="card" style={{ borderColor: AMBER_LINE, background: AMBER_BG }}>
              <div className="hd">
                <h3 style={{ color: AMBER }}>Needs a look</h3>
                <span className="folio">
                  {preview.unmatched.length} unmatched · {preview.warnings.length} warning
                  {preview.warnings.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="bd">
                {preview.unmatched.length > 0 && (
                  <p style={{ marginTop: 0 }}>
                    <b>No employee matches these Empl. IDs:</b>{' '}
                    <span className="mono">{preview.unmatched.join(', ')}</span>
                    <br />
                    <span className="muted" style={{ fontSize: 12 }}>
                      Expected an employee code like <span className="mono">DN001</span> for Empl.
                      ID <span className="mono">1</span>. Their rows will be skipped.
                    </span>
                  </p>
                )}
                {preview.warnings.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {preview.warnings.map((w, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="bd" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {(() => {
                const blocked = blockedReason(preview);
                return (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={onCommit}
                    disabled={committing || blocked !== null}
                    title={blocked ?? undefined}
                  >
                    {committing
                      ? `Importing ${preview.totalRows} rows…`
                      : `Import ${preview.matched.length} employee${
                          preview.matched.length === 1 ? '' : 's'
                        } → ${monthLabel(preview.periodMonth)}`}
                  </button>
                );
              })()}
              <button className="btn quiet" type="button" onClick={reset} disabled={committing}>
                Cancel
              </button>
              <span style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 12 }}>
                {committing
                  ? 'Writing attendance — this can take a while.'
                  : (blockedReason(preview) ?? 'Overwrites existing attendance for this month.')}
              </span>
            </div>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <div className="card">
          <div className="hd">
            <h3>{result.ok ? 'Import complete' : 'Import failed'}</h3>
            {preview && <span className="folio">{monthLabel(preview.periodMonth)}</span>}
          </div>
          <div className="bd">
            {result.ok ? (
              <>
                <div className="kpis" style={{ marginBottom: 14 }}>
                  <div className="card kpi">
                    <div className="lab">Inserted</div>
                    <div className="val" style={{ color: 'var(--p)' }}>
                      {result.inserted}
                    </div>
                    <div className="note">New attendance rows</div>
                  </div>
                  <div className="card kpi">
                    <div className="lab">Updated</div>
                    <div className="val">{result.updated}</div>
                    <div className="note">Existing rows overwritten</div>
                  </div>
                  <div className="card kpi">
                    <div className="lab">Skipped</div>
                    <div className="val" style={{ color: result.skipped ? 'var(--ab)' : undefined }}>
                      {result.skipped}
                    </div>
                    <div className="note">Unmatched or unreadable</div>
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div
                    className="card"
                    style={{ borderColor: AMBER_LINE, background: AMBER_BG, marginBottom: 14 }}
                  >
                    <div className="hd">
                      <h3 style={{ color: AMBER }}>Imported, with problems</h3>
                    </div>
                    <div className="bd">
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {result.errors.map((e, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="login-error" style={{ marginBottom: 14 }}>
                {result.error}
              </div>
            )}

            <button className="btn" onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
