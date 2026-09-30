'use client';

// Manage clearance, settlement, and exit letters before completing the exit and disabling the
// employee's login.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr, formatDate } from '@/lib/format';
import { initiateExit, refreshExitClearance, setClearanceItemCleared, setExitStage, prepareFullAndFinal, setFullAndFinalStatus, generateExitDocument, fetchClearanceItems, ensureExitInterview, saveExitInterview, fetchExitInterview, setKtStatus, deleteKtItem, fetchKtItems } from '@/lib/actions/exit';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import type { ExitCaseRow, ClearanceItemRow, EmployeeOption, ExitInterviewRow, KtItemRow } from '@/lib/queries';

const stageOrder: Array<ExitCaseRow['stage']> = [
  'initiated',
  'clearance',
  'settlement',
  'completed',
];

const stageLabel: Record<ExitCaseRow['stage'], string> = {
  initiated: 'Initiated',
  clearance: 'Clearance',
  settlement: 'Settlement',
  completed: 'Completed',
};

function ExitsScreen({ cases, employees }: { cases: ExitCaseRow[]; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openCase, setOpenCase] = useState<ExitCaseRow | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

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

  async function onComplete(c: ExitCaseRow) {
    const ok = await confirm({
      title: 'Complete exit',
      message:
        `Complete ${c.name}'s exit?\n\n` +
        `This is the LAST step: their login is disabled and they leave the active roster. ` +
        `Their records — attendance, payslips, documents — are all kept.`,
      confirmLabel: 'Complete exit',
      danger: true,
    });
    if (!ok) {
      return;
    }
    run(() => setExitStage(c.id, 'completed'), `${c.name}'s exit is complete.`);
  }

  return (
    <div className="content-container grid">
      {confirmDialog}
      {notificationContainer}

      <div className="card">
        <div className="card-header">
          <h3>Start an exit</h3>
        </div>
        <div className="card-body">
          <StartExitForm
            employees={employees}
            disabled={pending}
            onDone={(res) => {
              if (!res.ok) {
                showNotification(res.error ?? 'Could not start the exit.', 'error');
              } else {
                showNotification('Exit started — the employee is now on notice.', 'success');
                router.refresh();
              }
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>
            Active exit case{cases.length === 1 ? '' : 's'} <span style={{ color:'var(--brand)' }}>({cases.length})</span>
          </h3>
        </div>
        {cases.length === 0 ? (
          <div className="card-body">
            <p className="text-muted" style={{ margin: 0 }}>
              No exits in progress.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Last working day</th>
                  <th>Stage</th>
                  <th>Clearance</th>
                  <th>Settlement</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const outstanding =
                    c.assetsOutstanding + c.itemsOutstanding + c.clearanceItemsOpen;
                  const nextStage = stageOrder[stageOrder.indexOf(c.stage) + 1];
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{c.name}</b>{' '}
                        <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                          {c.code}
                        </span>
                        {c.reason && (
                          <div className="text-muted" style={{ fontSize: 11 }}>
                            {c.reason}
                          </div>
                        )}
                      </td>
                      <td className="text-monospace">
                        {c.lastWorkingDay ? formatDate(c.lastWorkingDay) : '—'}
                      </td>
                      <td>
                        <span
                          className="status-badge"
                          style={
                            c.stage === 'completed'
                              ? {
                                  borderColor: 'var(--attendance-present-border)',
                                  color: 'var(--attendance-present)',
                                  background: 'var(--attendance-present-background)',
                                }
                              : {
                                  borderColor: 'var(--attendance-late-border)',
                                  color: 'var(--attendance-late)',
                                  background: 'var(--attendance-late-background)',
                                }
                          }
                        >
                          {stageLabel[c.stage]}
                        </span>
                      </td>
                      <td>
                        {c.clearanceComplete ? (
                          <span style={{ color: 'var(--attendance-present)' }}>✓ clear</span>
                        ) : (
                          <span style={{ color: 'var(--attendance-late)' }}>
                            {outstanding} outstanding
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              {c.assetsOutstanding} asset · {c.itemsOutstanding} item
                            </div>
                          </span>
                        )}
                      </td>
                      <td className="text-monospace">
                        {c.fnfStatus ? (
                          <>
                            {inr(c.fnfNetPayable ?? 0)}
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              {c.fnfStatus}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted">not prepared</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="button quiet"
                            onClick={() => setOpenCase(c)}
                            disabled={pending}
                          >
                            Checklist
                          </button>
                          {c.stage !== 'completed' && (
                            <button
                              className="button quiet"
                              disabled={pending}
                              onClick={() =>
                                run(() => refreshExitClearance(c.id), 'Clearance refreshed.')
                              }
                              title="Re-scan the asset and material registers"
                            >
                              ↻ Clearance
                            </button>
                          )}
                          {!c.fnfStatus && c.stage !== 'completed' && (
                            <button
                              className="button quiet"
                              disabled={pending}
                              onClick={() =>
                                run(() => prepareFullAndFinal(c.id), 'Settlement prepared.')
                              }
                            >
                              Prepare F&amp;F
                            </button>
                          )}
                          {c.fnfStatus === 'draft' && (
                            <button
                              className="button quiet"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => setFullAndFinalStatus(c.id, 'approved'),
                                  'Settlement approved.',
                                )
                              }
                            >
                              Approve F&amp;F
                            </button>
                          )}
                          {c.fnfStatus === 'approved' && (
                            <button
                              className="button quiet"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => setFullAndFinalStatus(c.id, 'paid'),
                                  'Settlement marked paid.',
                                )
                              }
                            >
                              Mark F&amp;F paid
                            </button>
                          )}
                          {c.stage !== 'completed' && nextStage && nextStage !== 'completed' && (
                            <button
                              className="button quiet"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => setExitStage(c.id, nextStage),
                                  `Moved to ${stageLabel[nextStage]}.`,
                                )
                              }
                            >
                              → {stageLabel[nextStage]}
                            </button>
                          )}
                          {c.stage !== 'completed' && (
                            <button
                              className="button"
                              disabled={pending}
                              onClick={() => onComplete(c)}
                            >
                              Complete
                            </button>
                          )}
                          <DocMenu caseId={c.id} disabled={pending} showNotification={showNotification} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openCase && (
        <ClearanceDrawer
          exitCase={openCase}
          employees={employees}
          onClose={() => setOpenCase(null)}
          showNotification={showNotification}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** Issue relieving / experience / F&F PDFs into the documents bucket. */
function DocMenu({
  caseId,
  disabled,
  showNotification,
}: {
  caseId: string;
  disabled: boolean;
  showNotification: (m: string, k?: 'info' | 'error' | 'success') => void;
}) {
  const [busy, setBusy] = useState(false);
  const gen = async (kind: 'relieving' | 'experience' | 'fnf') => {
    setBusy(true);
    const res = await generateExitDocument(caseId, kind);
    setBusy(false);
    if (!res.ok) {
      showNotification(res.error ?? 'The document could not be generated.', 'error');
    } else {
      showNotification('Document generated and filed.', 'success');
    }
  };
  return (
    <>
      <button className="button quiet" disabled={disabled || busy} onClick={() => gen('relieving')}>
        {busy ? '…' : '📄 Relieving'}
      </button>
      <button className="button quiet" disabled={disabled || busy} onClick={() => gen('experience')}>
        📄 Experience
      </button>
      <button className="button quiet" disabled={disabled || busy} onClick={() => gen('fnf')}>
        📄 F&amp;F
      </button>
    </>
  );
}

/** The per-case clearance checklist, loaded on open. */
function ClearanceDrawer({
  exitCase,
  employees,
  onClose,
  showNotification,
  onChanged,
}: {
  exitCase: ExitCaseRow;
  employees: EmployeeOption[];
  onClose: () => void;
  showNotification: (m: string, k?: 'info' | 'error' | 'success') => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ClearanceItemRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Load the checklist when the drawer opens (and whenever a different case is
  // opened without unmounting).
  useEffect(() => {
    let live = true;
    setItems(null);
    fetchClearanceItems(exitCase.id).then((rows) => {
      if (live) {
        setItems(rows);
      }
    });
    return () => {
      live = false;
    };
  }, [exitCase.id]);

  return (
    <>
      <div className="dialog-backdrop is-active" onClick={onClose} />
      <aside className="drawer is-active" aria-label="Exit clearance checklist">
        <div className="drawer-header">
          <h3>Clearance · {exitCase.name}</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="button quiet" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {items === null ? (
            <p className="text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-muted">
              Nothing outstanding — this employee holds no assets or materials, and no manual
              clearance items have been added.
            </p>
          ) : (
            items.map((it) => (
              <label
                key={it.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-strong)',
                }}
              >
                <input
                  type="checkbox"
                  checked={it.cleared}
                  disabled={busy === it.id}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setBusy(it.id);
                    const res = await setClearanceItemCleared(it.id, next);
                    setBusy(null);
                    if (!res.ok) {
                      showNotification(res.error ?? 'Could not update the item.', 'error');
                    } else {
                      setItems((prev) =>
                        (prev ?? []).map((p) => (p.id === it.id ? { ...p, cleared: next } : p)),
                      );
                      onChanged();
                    }
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ textDecoration: it.cleared ? 'line-through' : undefined }}>
                    {it.description ?? it.area}
                  </span>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {it.area}
                  </div>
                </span>
              </label>
            ))
          )}

          <InterviewSection exitCaseId={exitCase.id} showNotification={showNotification} />
          <KtSection exitCaseId={exitCase.id} employees={employees} showNotification={showNotification} />
        </div>
        <div className="drawer-footer">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * Exit interview. The questions are ROWS (written once when the interview is
 * opened), so editing the questionnaire later never rewrites what a past leaver
 * was actually asked — only the answers are editable here.
 */
function InterviewSection({
  exitCaseId,
  showNotification,
}: {
  exitCaseId: string;
  showNotification: (m: string, k?: 'info' | 'error' | 'success') => void;
}) {
  const [rows, setRows] = useState<ExitInterviewRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    fetchExitInterview(exitCaseId).then((r) => {
      if (!live) {
        return;
      }
      setRows(r);
      setDraft(Object.fromEntries(r.map((x) => [x.id, x.answer ?? ''])));
    });
    return () => {
      live = false;
    };
  }, [exitCaseId]);

  const answered = (rows ?? []).filter((r) => r.answer).length;

  return (
    <>
      <div className="section-heading">
        Exit interview{rows && rows.length > 0 ? ` · ${answered}/${rows.length} answered` : ''}
      </div>
      {rows === null ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <>
          <p className="text-muted" style={{ fontSize: 13 }}>
            No interview started for this exit yet.
          </p>
          <button
            className="button quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await ensureExitInterview(exitCaseId);
              if (res.ok) {
                setRows(await fetchExitInterview(exitCaseId));
              } else {
                showNotification(res.error ?? 'Could not open the interview.', 'error');
              }
              setBusy(false);
            }}
          >
            {busy ? 'Opening…' : 'Start exit interview'}
          </button>
        </>
      ) : (
        <>
          {rows.map((r) => (
            <div className="form-field" key={r.id}>
              <label>{r.question}</label>
              <textarea
                rows={2}
                value={draft[r.id] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 8,
                  font: 'inherit',
                  background: '#fff',
                  resize: 'vertical',
                }}
              />
            </div>
          ))}
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await saveExitInterview(
                rows.map((r) => ({ id: r.id, answer: draft[r.id] ?? '' })),
              );
              setBusy(false);
              if (!res.ok) {
                showNotification(res.error ?? 'Could not save the interview.', 'error');
              } else {
                showNotification('Interview saved.', 'success');
                setRows(await fetchExitInterview(exitCaseId));
              }
            }}
          >
            {busy ? 'Saving…' : 'Save answers'}
          </button>
        </>
      )}
    </>
  );
}

/** Knowledge-transfer checklist: what is handed over, to whom, and how far along. */
function KtSection({
  exitCaseId,
  employees,
  showNotification,
}: {
  exitCaseId: string;
  employees: EmployeeOption[];
  showNotification: (m: string, k?: 'info' | 'error' | 'success') => void;
}) {
  const [rows, setRows] = useState<KtItemRow[] | null>(null);

  const [handoverTo, setHandoverTo] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => setRows(await fetchKtItems(exitCaseId));

  useEffect(() => {
    let live = true;
    setRows(null);
    fetchKtItems(exitCaseId).then((r) => {
      if (live) {
        setRows(r);
      }
    });
    return () => {
      live = false;
    };
  }, [exitCaseId]);

  const nextStatus: Record<string, string> = {
    pending: 'in_progress',
    in_progress: 'done',
    done: 'pending',
  };

  return (
    <>
      <div className="section-heading">
        Knowledge transfer
        {rows && rows.length > 0
          ? ` · ${rows.filter((r) => r.status === 'done').length}/${rows.length} done`
          : ''}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <EmployeePicker
          label="Handover to (optional)"
          employees={employees}
          value={handoverTo}
          onChange={setHandoverTo}
          placeholder="Unassigned — type a name or code…"
          disabled={busy}
          style={{ flex: '1 1 130px', marginBottom: 0 }}
        />
      </div>

      {rows === null ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>
          Nothing recorded for handover yet.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>To</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.task}</td>
                  <td>{r.handoverName ?? <span className="text-muted">—</span>}</td>
                  <td>
                    {/* Cycle checklist status: pending → in_progress → done → pending. */}
                    <button
                      className="button quiet"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await setKtStatus(r.id, nextStatus[r.status]);
                        setBusy(false);
                        if (!res.ok) {
                          showNotification(res.error ?? 'Could not update the item.', 'error');
                        } else {
                          await reload();
                        }
                      }}
                      title="Click to advance"
                    >
                      {r.status.replace('_', ' ')}
                    </button>
                  </td>
                  <td>
                    <button
                      className="button quiet"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await deleteKtItem(r.id);
                        setBusy(false);
                        if (!res.ok) {
                          showNotification(res.error ?? 'Could not remove the item.', 'error');
                        } else {
                          await reload();
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Open a new exit case. */
function StartExitForm({
  employees,
  disabled,
  onDone,
}: {
  employees: EmployeeOption[];
  disabled: boolean;
  onDone: (res: { ok: boolean; error?: string }) => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [resignationDate, setResignationDate] = useState('');
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = employeeId && resignationDate && lastWorkingDay;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <EmployeePicker
        employees={employees}
        value={employeeId}
        onChange={setEmployeeId}
        disabled={disabled || busy}
        style={{ flex: '1 1 180px', marginBottom: 0 }}
      />
      <div className="form-field" style={{ marginBottom: 0 }}>
        <label>Resignation date</label>
        <input
          type="date"
          value={resignationDate}
          onChange={(e) => setResignationDate(e.target.value)}
        />
      </div>
      <div className="form-field" style={{ marginBottom: 0 }}>
        <label>Last working day</label>
        <input
          type="date"
          value={lastWorkingDay}
          onChange={(e) => setLastWorkingDay(e.target.value)}
        />
      </div>
      <div className="form-field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
        <label>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
      </div>
      <button
        className="button primary"
        disabled={disabled || busy || !ready}
        onClick={async () => {
          setBusy(true);
          const res = await initiateExit({ employeeId, resignationDate, lastWorkingDay, reason });
          setBusy(false);
          if (res.ok) {
            setEmployeeId('');
            setResignationDate('');
            setLastWorkingDay('');
            setReason('');
          }
          onDone(res);
        }}
      >
        {busy ? 'Starting…' : 'Start exit'}
      </button>
    </div>
  );
}

export { ExitsScreen };
