'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { previewImport, commitImport } from '@/lib/actions/import';
import { exportRegisterImportTemplateXlsx } from '@/lib/actions/export';
import { XlsxExportButton } from '@/components/ui/XlsxExportButton';
import { monthLabelUTC, monthOptionsAround } from '@/lib/display-formatting';
import sectionStyles from '@/components/ui/SectionCard.module.css';
import type { CommitResult, ImportPreview, PreviewResult } from '@/lib/actions/import';
import type { AppRole } from '@/types/database';

// Match commitImport's reaches: next month down to 12 months back.
const importRoles: AppRole[] = ['super_admin', 'admin', 'hr'];
const monthsBack = 12;
const monthsAhead = 1;

function ImportScreen({
  canImport,
  role,
  currentMonth,
}: {
  canImport: boolean;
  role: AppRole | null;
  // First day of the current month in IST, resolved on the server.
  currentMonth: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // The blank template is data-free, so it is offered to any staff role; the
  // server action re-checks the role before building it.
  const canDownloadTemplate = !!role && importRoles.includes(role);

  // Which month the downloaded template is stamped with (cell B2). Defaults to
  // the current month — the overwhelmingly common case — with the dropdown there
  // for back-filling a month that was missed.
  const [monthMode, setMonthMode] = useState<'current' | 'other'>('current');
  const monthChoices = monthOptionsAround(currentMonth, monthsBack, monthsAhead);
  // Pre-select the PREVIOUS month: catching up on a month that has ended is the
  // reason to reach for this control at all.
  const [otherMonth, setOtherMonth] = useState(() => monthOptionsAround(currentMonth, 1, 0)[1]);
  const templateMonth = monthMode === 'current' ? currentMonth : otherMonth;

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

  // Hide the previous preview while the next upload is being parsed; useActionState retains the
  // previous result until it completes.
  const step: 'upload' | 'preview' | 'done' =
    result !== null ? 'done' : preview && !cancelled && !previewing ? 'preview' : 'upload';

  function reset() {
    setCancelled(true);
    setFile(null);
    setResult(null);
    formRef.current?.reset();
  }

  function onCommit() {
    if (!file) {
      return;
    }
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
    if (!canImport) {
      return `Importing the register needs an admin or HR account${
        role ? ` — yours is “${role}”.` : '.'
      }`;
    }
    if (!file) {
      return 'Choose the register file again before importing.';
    }
    if (p.totalRows === 0) {
      return 'No rows in this sheet could be matched to an employee, so there is nothing to write.';
    }
    return null;
  }

  return (
    <div className="content-container grid data-import-page">
      {!canImport && (
        <div className="card import-warning">
          <div className="card-header">
            <h3 className="import-warning-title">Read-only access</h3>
          </div>
          <div className="card-body">
            <p className="text-muted import-message">
              Importing the register needs an admin or HR account
              {role ? ` — yours is “${role}”.` : '.'} You can still upload a file to preview what it
              contains; the import button is disabled.
            </p>
          </div>
        </div>
      )}

      {step === 'upload' && (
        <div className={`card ${sectionStyles.panel}`}>
          <div className="card-header">
            <h3>Upload monthly register</h3>
            <span className="import-spacer" />
            {canDownloadTemplate && (
              // An arrow closure, not .bind — it is recreated on every render, so
              // the click always sends the month currently selected below.
              <XlsxExportButton
                action={() => exportRegisterImportTemplateXlsx(templateMonth)}
                label="Download template"
                className="button"
              />
            )}
          </div>
          <div className="card-body">
            {canDownloadTemplate && (
              <>
                <fieldset className={'import-month-fieldset'}>
                  <legend>Template month</legend>
                  <div className={'import-month-choices'}>
                    <label>
                      <input
                        type="radio"
                        name="template-month-mode"
                        value="current"
                        checked={monthMode === 'current'}
                        onChange={() => setMonthMode('current')}
                      />
                      <span>Current month — {monthLabelUTC(currentMonth)}</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="template-month-mode"
                        value="other"
                        checked={monthMode === 'other'}
                        onChange={() => setMonthMode('other')}
                      />
                      <span>Other month</span>
                    </label>
                    {/* Disabled rather than hidden, so the row does not reflow on toggle. */}
                    <select
                      value={otherMonth}
                      disabled={monthMode !== 'other'}
                      onChange={(e) => setOtherMonth(e.target.value)}
                      aria-label="Month to stamp the template with"
                    >
                      {monthChoices.map((m) => (
                        <option key={m} value={m}>
                          {monthLabelUTC(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                </fieldset>
                <p className={'import-template-hint'}>
                  <b>Download template</b> creates a blank register for the selected month. Fill it
                  in, then upload the completed Excel file below.
                </p>
              </>
            )}
            <form
              className={`${sectionStyles.form} ${'import-upload-form'}`}
              ref={formRef}
              action={previewAction}
              onSubmit={() => {
                setCancelled(false);
                setResult(null);
              }}
            >
              <div className="form-field">
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
                <span className={'import-file-hint'}>
                  The sheet is read exactly as laid out: month from B2, day columns across row 4,
                  one four-row block per employee from row 6. Nothing is written until you confirm
                  the preview.
                </span>
              </div>

              {previewError && <div className="error-message">{previewError}</div>}

              <button className="button primary" type="submit" disabled={previewing || !file}>
                {previewing ? 'Reading the sheet…' : 'Preview import'}
              </button>
            </form>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="card">
            <div className="card-header">
              <h3>{monthLabelUTC(preview.periodMonth)}</h3>
              <span className="card-caption">
                {preview.daysInMonth} days · {preview.matched.length} employee
                {preview.matched.length === 1 ? '' : 's'} matched · {preview.totalRows} row
                {preview.totalRows === 1 ? '' : 's'} to write
              </span>
              <span className="import-spacer" />
              <span className="status-badge">Preview only — nothing saved yet</span>
            </div>

            {preview.matched.length === 0 ? (
              <div className="card-body">
                <p className="empty-state">
                  No employee in this sheet could be matched to a record in the system.
                </p>
              </div>
            ) : (
              <div className="import-preview">
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
                        <td className="text-monospace text-muted">{m.code}</td>
                        <td>
                          <b>{m.name}</b>
                        </td>
                        <td className="text-monospace">{m.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(preview.unmatched.length > 0 || preview.warnings.length > 0) && (
            <div className="card import-warning">
              <div className="card-header">
                <h3 className="import-warning-title">Needs a look</h3>
                <span className="card-caption">
                  {preview.unmatched.length} unmatched · {preview.warnings.length} warning
                  {preview.warnings.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="card-body">
                {preview.unmatched.length > 0 && (
                  <p className="import-warning-note">
                    <b>No employee matches these Empl. IDs:</b>{' '}
                    <span className="text-monospace">{preview.unmatched.join(', ')}</span>
                    <br />
                    <span className="text-muted import-note">
                      Expected an employee code like <span className="text-monospace">DN001</span>{' '}
                      for Empl. ID <span className="text-monospace">1</span>. Their rows will be
                      skipped.
                    </span>
                  </p>
                )}
                {preview.warnings.length > 0 && (
                  <ul className="import-problems">
                    {preview.warnings.map((w, i) => (
                      <li key={i} className="import-problem">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-body import-progress">
              {(() => {
                const blocked = blockedReason(preview);
                return (
                  <button
                    className="button primary"
                    type="button"
                    onClick={onCommit}
                    disabled={committing || blocked !== null}
                    data-tooltip-content={blocked ?? undefined}
                  >
                    {committing
                      ? `Importing ${preview.totalRows} rows…`
                      : `Import ${preview.matched.length} employee${
                          preview.matched.length === 1 ? '' : 's'
                        } → ${monthLabelUTC(preview.periodMonth)}`}
                  </button>
                );
              })()}
              <button className="button quiet" type="button" onClick={reset} disabled={committing}>
                Cancel
              </button>
              <span className="import-spacer" />
              <span className="text-muted import-note">
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
          <div className="card-header">
            <h3>{result.ok ? 'Import complete' : 'Import failed'}</h3>
            {preview && <span className="card-caption">{monthLabelUTC(preview.periodMonth)}</span>}
          </div>
          <div className="card-body">
            {result.ok ? (
              <>
                <div className="summary-cards import-result">
                  <div className="card summary-card">
                    <div className="metric-label">Inserted</div>
                    <div className="metric-value import-success">{result.inserted}</div>
                    <div className="metric-note">New attendance rows</div>
                  </div>
                  <div className="card summary-card">
                    <div className="metric-label">Updated</div>
                    <div className="metric-value">{result.updated}</div>
                    <div className="metric-note">Existing rows overwritten</div>
                  </div>
                  <div className="card summary-card">
                    <div className="metric-label">Skipped</div>
                    <div
                      className="metric-value"
                      style={{ color: result.skipped ? 'var(--attendance-absent)' : undefined }}
                    >
                      {result.skipped}
                    </div>
                    <div className="metric-note">Unmatched or unreadable</div>
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div className="card import-result-warning">
                    <div className="card-header">
                      <h3 className="import-warning-title">Imported, with problems</h3>
                    </div>
                    <div className="card-body">
                      <ul className="import-problems">
                        {result.errors.map((e, i) => (
                          <li key={i} className="import-problem">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="error-message import-result">{result.error}</div>
            )}

            <button className="button" onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { ImportScreen };
