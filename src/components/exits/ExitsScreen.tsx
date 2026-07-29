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
} from '@/lib/actions/exit';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { ExitCaseRow, ClearanceItemRow, EmployeeOption } from '@/lib/queries';

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
  onClose,
  toast,
  onChanged,
}: {
  exitCase: ExitCaseRow;
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
        </div>
        <div className="dft">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </aside>
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
