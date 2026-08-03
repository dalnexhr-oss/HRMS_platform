'use client';

// The HR exits board: start an exit, work the clearance checklist, settle the
// F&F, issue the letters, and only then complete the exit (which is what
// finally disables the login — see src/lib/actions/exit.ts for why that order).
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr, formatDate } from '@/lib/format';
import {
  initiateExit,
  refreshExitClearance,
  setClearanceItemCleared,
  setExitStage,
  prepareFullAndFinal,
  setFullAndFinalStatus,
  generateExitDocument,
  fetchClearanceItems,
  ensureExitInterview,
  saveExitInterview,
  fetchExitInterview,
  addKtItem,
  setKtStatus,
  deleteKtItem,
  fetchKtItems,
} from '@/lib/actions/exit';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type {
  ExitCaseRow,
  ClearanceItemRow,
  EmployeeOption,
  ExitInterviewRow,
  KtItemRow,
} from '@/lib/queries';

const STAGE_ORDER: ExitCaseRow['stage'][] = ['initiated', 'clearance', 'settlement', 'completed'];

const STAGE_LABEL: Record<ExitCaseRow['stage'], string> = {
  initiated: 'Initiated',
  clearance: 'Clearance',
  settlement: 'Settlement',
  completed: 'Completed',
};

export function ExitsScreen({
  cases,
  employees,
}: {
  cases: ExitCaseRow[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openCase, setOpenCase] = useState<ExitCaseRow | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

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
    if (!ok) return;
    run(() => setExitStage(c.id, 'completed'), `${c.name}'s exit is complete.`);
  }

  return (
    <div className="wrap grid">
      {confirmDialog}
      {toastNode}

      <div className="card">
        <div className="hd">
          <h3>Start an exit</h3>
        </div>
        <div className="bd">
          <StartExitForm
            employees={employees}
            disabled={pending}
            onDone={(res) => {
              if (!res.ok) toast(res.error ?? 'Could not start the exit.', 'error');
              else {
                toast('Exit started — the employee is now on notice.', 'success');
                router.refresh();
              }
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Exits</h3>
          <span className="folio">{cases.length} case{cases.length === 1 ? '' : 's'}</span>
        </div>
        {cases.length === 0 ? (
          <div className="bd">
            <p className="muted" style={{ margin: 0 }}>No exits in progress.</p>
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
                  const outstanding = c.assetsOutstanding + c.itemsOutstanding + c.clearanceItemsOpen;
                  const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(c.stage) + 1];
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{c.name}</b>{' '}
                        <span className="mono muted" style={{ fontSize: 11 }}>{c.code}</span>
                        {c.reason && (
                          <div className="muted" style={{ fontSize: 11 }}>{c.reason}</div>
                        )}
                      </td>
                      <td className="mono">{c.lastWorkingDay ? formatDate(c.lastWorkingDay) : '—'}</td>
                      <td>
                        <span
                          className="pill"
                          style={
                            c.stage === 'completed'
                              ? { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }
                              : { borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' }
                          }
                        >
                          {STAGE_LABEL[c.stage]}
                        </span>
                      </td>
                      <td>
                        {c.clearanceComplete ? (
                          <span style={{ color: 'var(--p)' }}>✓ clear</span>
                        ) : (
                          <span style={{ color: 'var(--lm)' }}>
                            {outstanding} outstanding
                            <div className="muted" style={{ fontSize: 11 }}>
                              {c.assetsOutstanding} asset · {c.itemsOutstanding} item
                            </div>
                          </span>
                        )}
                      </td>
                      <td className="mono">
                        {c.fnfStatus ? (
                          <>
                            {inr(c.fnfNetPayable ?? 0)}
                            <div className="muted" style={{ fontSize: 11 }}>{c.fnfStatus}</div>
                          </>
                        ) : (
                          <span className="muted">not prepared</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn quiet" onClick={() => setOpenCase(c)} disabled={pending}>
                            Checklist
                          </button>
                          {c.stage !== 'completed' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() => run(() => refreshExitClearance(c.id), 'Clearance refreshed.')}
                              title="Re-scan the asset and material registers"
                            >
                              ↻ Clearance
                            </button>
                          )}
                          {!c.fnfStatus && c.stage !== 'completed' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() => run(() => prepareFullAndFinal(c.id), 'Settlement prepared.')}
                            >
                              Prepare F&amp;F
                            </button>
                          )}
                          {c.fnfStatus === 'draft' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() => run(() => setFullAndFinalStatus(c.id, 'approved'), 'Settlement approved.')}
                            >
                              Approve F&amp;F
                            </button>
                          )}
                          {c.fnfStatus === 'approved' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() => run(() => setFullAndFinalStatus(c.id, 'paid'), 'Settlement marked paid.')}
                            >
                              Mark F&amp;F paid
                            </button>
                          )}
                          {c.stage !== 'completed' && nextStage && nextStage !== 'completed' && (
                            <button
                              className="btn quiet"
                              disabled={pending}
                              onClick={() => run(() => setExitStage(c.id, nextStage), `Moved to ${STAGE_LABEL[nextStage]}.`)}
                            >
                              → {STAGE_LABEL[nextStage]}
                            </button>
                          )}
                          {c.stage !== 'completed' && (
                            <button className="btn" disabled={pending} onClick={() => onComplete(c)}>
                              Complete
                            </button>
                          )}
                          <DocMenu caseId={c.id} disabled={pending} toast={toast} />
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
          toast={toast}
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
  toast,
}: {
  caseId: string;
  disabled: boolean;
  toast: (m: string, k?: 'info' | 'error' | 'success') => void;
}) {
  const [busy, setBusy] = useState(false);
  const gen = async (kind: 'relieving' | 'experience' | 'fnf') => {
    setBusy(true);
    const res = await generateExitDocument(caseId, kind);
    setBusy(false);
    if (!res.ok) toast(res.error ?? 'The document could not be generated.', 'error');
    else toast('Document generated and filed.', 'success');
  };
  return (
    <>
      <button className="btn quiet" disabled={disabled || busy} onClick={() => gen('relieving')}>
        {busy ? '…' : '📄 Relieving'}
      </button>
      <button className="btn quiet" disabled={disabled || busy} onClick={() => gen('experience')}>
        📄 Experience
      </button>
      <button className="btn quiet" disabled={disabled || busy} onClick={() => gen('fnf')}>
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
  toast,
  onChanged,
}: {
  exitCase: ExitCaseRow;
  employees: EmployeeOption[];
  onClose: () => void;
  toast: (m: string, k?: 'info' | 'error' | 'success') => void;
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
      if (live) setItems(rows);
    });
    return () => {
      live = false;
    };
  }, [exitCase.id]);

  return (
    <>
      <div className="overlay on" onClick={onClose} />
      <aside className="drawer on" aria-label="Exit clearance checklist">
        <div className="dhd">
          <h3>Clearance · {exitCase.name}</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn quiet" onClick={onClose}>✕</button>
        </div>
        <div className="dbd">
          {items === null ? (
            <p className="muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="muted">
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
                  borderBottom: '1px solid var(--line-2)',
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
                    if (!res.ok) toast(res.error ?? 'Could not update the item.', 'error');
                    else {
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
                  <div className="muted" style={{ fontSize: 11 }}>{it.area}</div>
                </span>
              </label>
            ))
          )}

          <InterviewSection exitCaseId={exitCase.id} toast={toast} />
          <KtSection exitCaseId={exitCase.id} employees={employees} toast={toast} />
        </div>
        <div className="dft">
          <button type="button" className="btn" onClick={onClose}>Close</button>
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
  toast,
}: {
  exitCaseId: string;
  toast: (m: string, k?: 'info' | 'error' | 'success') => void;
}) {
  const [rows, setRows] = useState<ExitInterviewRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    fetchExitInterview(exitCaseId).then((r) => {
      if (!live) return;
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
      <div className="fold">
        Exit interview{rows && rows.length > 0 ? ` · ${answered}/${rows.length} answered` : ''}
      </div>
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            No interview started for this exit yet.
          </p>
          <button
            className="btn quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await ensureExitInterview(exitCaseId);
              if (res.ok) setRows(await fetchExitInterview(exitCaseId));
              else toast(res.error ?? 'Could not open the interview.', 'error');
              setBusy(false);
            }}
          >
            {busy ? 'Opening…' : 'Start exit interview'}
          </button>
        </>
      ) : (
        <>
          {rows.map((r) => (
            <div className="f" key={r.id}>
              <label>{r.question}</label>
              <textarea
                rows={2}
                value={draft[r.id] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--line-2)',
                  borderRadius: 8,
                  font: 'inherit',
                  background: '#fff',
                  resize: 'vertical',
                }}
              />
            </div>
          ))}
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await saveExitInterview(
                rows.map((r) => ({ id: r.id, answer: draft[r.id] ?? '' })),
              );
              setBusy(false);
              if (!res.ok) toast(res.error ?? 'Could not save the interview.', 'error');
              else {
                toast('Interview saved.', 'success');
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
  toast,
}: {
  exitCaseId: string;
  employees: EmployeeOption[];
  toast: (m: string, k?: 'info' | 'error' | 'success') => void;
}) {
  const [rows, setRows] = useState<KtItemRow[] | null>(null);
  
  const [handoverTo, setHandoverTo] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => setRows(await fetchKtItems(exitCaseId));

  useEffect(() => {
    let live = true;
    setRows(null);
    fetchKtItems(exitCaseId).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [exitCaseId]);

  const NEXT: Record<string, string> = { pending: 'in_progress', in_progress: 'done', done: 'pending' };

  return (
    <>
      <div className="fold">
        Knowledge transfer
        {rows && rows.length > 0 ? ` · ${rows.filter((r) => r.status === 'done').length}/${rows.length} done` : ''}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
        
        <div className="f" style={{ flex: '1 1 130px', marginBottom: 0 }}>
          <label>Handover to</label>
          <select value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}>
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
            ))}
          </select>
        </div>
        
      </div>

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Nothing recorded for handover yet.</p>
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
                  <td>{r.handoverName ?? <span className="muted">—</span>}</td>
                  <td>
                    {/* One button cycles pending → in_progress → done → pending;
                        the status set matches the 0037 CHECK constraint exactly. */}
                    <button
                      className="btn quiet"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await setKtStatus(r.id, NEXT[r.status]);
                        setBusy(false);
                        if (!res.ok) toast(res.error ?? 'Could not update the item.', 'error');
                        else await reload();
                      }}
                      title="Click to advance"
                    >
                      {r.status.replace('_', ' ')}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn quiet"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await deleteKtItem(r.id);
                        setBusy(false);
                        if (!res.ok) toast(res.error ?? 'Could not remove the item.', 'error');
                        else await reload();
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
      <div className="f" style={{ flex: '1 1 180px', marginBottom: 0 }}>
        <label>Employee</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
          ))}
        </select>
      </div>
      <div className="f" style={{ marginBottom: 0 }}>
        <label>Resignation date</label>
        <input type="date" value={resignationDate} onChange={(e) => setResignationDate(e.target.value)} />
      </div>
      <div className="f" style={{ marginBottom: 0 }}>
        <label>Last working day</label>
        <input type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} />
      </div>
      <div className="f" style={{ flex: '1 1 160px', marginBottom: 0 }}>
        <label>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
      </div>
      <button
        className="btn primary"
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
