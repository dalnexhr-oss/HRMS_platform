'use client';

// One employee's complete document picture: what is on file now, what is
// missing, and every superseded version behind each document.
//
// Loads the FULL history on open (getEmployeeDocumentHistory), not the register
// row, because the register deliberately carries only current versions — the
// history is the reason this panel exists.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import {
  fetchEmployeeDocumentHistory,
  verifyEmployeeDocument,
  deleteEmployeeDocument,
} from '@/lib/actions/documents';
import { documentCategoryLabel, REQUIRED_DOCUMENT_CATEGORIES } from '@/lib/constants';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';
import { openDocument } from './openDocument';
import { StatusPill } from './StatusPill';
import type { EmployeeDocumentRow } from '@/lib/queries';

/** All versions of one document, current first. */
interface DocumentChain {
  current: EmployeeDocumentRow;
  history: EmployeeDocumentRow[];
}

/**
 * Group flat rows into chains by doc_group.
 *
 * The row with no supersession is the current one. A chain can legitimately
 * have none for a moment — replaceEmployeeDocument inserts the new version
 * before stamping the old one — so the newest version stands in rather than the
 * whole document disappearing from the panel.
 */
function toChains(rows: EmployeeDocumentRow[]): DocumentChain[] {
  const byGroup = new Map<string, EmployeeDocumentRow[]>();
  for (const r of rows) {
    const list = byGroup.get(r.docGroup);
    if (list) list.push(r);
    else byGroup.set(r.docGroup, [r]);
  }
  const chains: DocumentChain[] = [];
  for (const versions of byGroup.values()) {
    const ordered = [...versions].sort((a, b) => b.version - a.version);
    const current = ordered.find((v) => v.isCurrent) ?? ordered[0];
    chains.push({ current, history: ordered.filter((v) => v.id !== current.id) });
  }
  return chains.sort((a, b) => b.current.uploadedAt.localeCompare(a.current.uploadedAt));
}

export function EmployeeDocumentsPanel({
  employee,
  onClose,
  onReplace,
  onUpload,
}: {
  employee: { id: string; code: string; name: string } | null;
  onClose: () => void;
  onReplace: (document: EmployeeDocumentRow) => void;
  onUpload: (employeeId: string) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EmployeeDocumentRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();
  const { toast, toastNode } = useToast();

  useEffect(() => {
    let live = true;
    if (!employee) {
      setRows(null);
      return;
    }
    setRows(null);
    fetchEmployeeDocumentHistory(employee.id).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [employee?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chains = rows ? toChains(rows) : [];
  const heldVerified = new Set(
    chains.filter((c) => c.current.status === 'verified' && c.current.category).map((c) => c.current.category!),
  );
  const missing = REQUIRED_DOCUMENT_CATEGORIES.filter((c) => !heldVerified.has(c));

  function reload() {
    if (!employee) return;
    fetchEmployeeDocumentHistory(employee.id).then(setRows);
    router.refresh();
  }

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) toast(res.error ?? 'The action failed.', 'error');
      else {
        toast(okMsg, 'success');
        reload();
      }
    });
  }

  async function onReturn(d: EmployeeDocumentRow) {
    const reason = await prompt({
      title: 'Return document',
      message: 'What is wrong with it? (shown to the employee)',
      placeholder: 'e.g. The PAN scan is cut off at the edge',
      confirmLabel: 'Return',
      danger: true,
      validate: (v) => (v.trim() ? null : 'Enter what needs fixing.'),
    });
    if (reason === null) return;
    run(d.id, () => verifyEmployeeDocument(d.id, false, reason.trim()), 'Returned to the employee.');
  }

  async function onDelete(d: EmployeeDocumentRow) {
    const ok = await confirm({
      title: 'Delete this version?',
      message: d.isCurrent
        ? 'The version before it becomes current again. The file itself is kept.'
        : 'This removes it from the document’s history. The file itself is kept.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    run(d.id, () => deleteEmployeeDocument(d.id), 'Version deleted.');
  }

  const open = employee !== null;

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside
        className={`drawer${open ? ' on' : ''}`}
        aria-label={employee ? `Documents for ${employee.name}` : 'Employee documents'}
      >
        {confirmDialog}
        {promptDialog}
        {toastNode}

        <div className="dhd">
          <h3>
            {employee?.name} <span className="mono muted" style={{ fontSize: 12 }}>{employee?.code}</span>
          </h3>
          <span style={{ flex: 1 }} />
          <button className="btn quiet" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="dbd" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={!employee} onClick={() => employee && onUpload(employee.id)}>
              + Upload for {employee ? employee.name.split(' ')[0] : 'employee'}
            </button>
            <span style={{ flex: 1 }} />
            <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
              {chains.length} document{chains.length === 1 ? '' : 's'}
            </span>
          </div>

          {missing.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--lm)' }}>
              <div className="bd">
                <b style={{ color: 'var(--lm)' }}>Missing {missing.length} required document
                  {missing.length === 1 ? '' : 's'}</b>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {missing.map((c) => documentCategoryLabel(c)).join(' · ')}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  A document counts as held once it is <b>verified</b> — one that is awaiting
                  verification or has been returned still shows as missing.
                </div>
              </div>
            </div>
          )}

          {rows === null ? (
            <p className="muted" style={{ margin: 0 }}>Loading…</p>
          ) : chains.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nothing on file for this employee yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {chains.map(({ current, history }) => (
                <div className="card" key={current.docGroup}>
                  <div className="bd" style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <b>{documentCategoryLabel(current.category, current.source === 'issued')}</b>
                      <span className="muted" style={{ fontSize: 12 }}>{current.title ?? '—'}</span>
                      <span style={{ flex: 1 }} />
                      <StatusPill row={current} />
                    </div>

                    <div className="muted" style={{ fontSize: 11 }}>
                      v{current.version} · filed {formatDate(current.uploadedAt.slice(0, 10))}
                      {current.source === 'issued' && ' · issued by HR'}
                      {current.verifiedAt && ` · verified ${formatDate(current.verifiedAt.slice(0, 10))}`}
                    </div>

                    {current.verifyRemark && (
                      <div style={{ fontSize: 12, color: 'var(--hd)' }}>
                        <b>Note:</b> {current.verifyRemark}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn quiet" onClick={() => openDocument(current.id, (m) => toast(m, 'error'))}>
                        📎 Open
                      </button>
                      {current.status !== 'verified' && (
                        <button
                          className="btn primary"
                          disabled={pending && busy === current.id}
                          onClick={() =>
                            run(current.id, () => verifyEmployeeDocument(current.id, true), 'Document verified.')
                          }
                        >
                          ✓ Verify
                        </button>
                      )}
                      {current.source === 'uploaded' && (
                        <>
                          <button className="btn" onClick={() => onReplace(current)}>
                            ⟳ Replace
                          </button>
                          <button
                            className="btn"
                            disabled={pending && busy === current.id}
                            onClick={() => onReturn(current)}
                          >
                            Return
                          </button>
                        </>
                      )}
                      <button
                        className="btn danger"
                        disabled={pending && busy === current.id}
                        onClick={() => onDelete(current)}
                      >
                        Delete
                      </button>
                      {history.length > 0 && (
                        <button
                          className="btn quiet"
                          onClick={() => setExpanded(expanded === current.docGroup ? null : current.docGroup)}
                        >
                          {expanded === current.docGroup ? 'Hide' : 'History'} ({history.length})
                        </button>
                      )}
                    </div>

                    {expanded === current.docGroup && history.length > 0 && (
                      <div
                        style={{
                          borderTop: '1px solid var(--line)',
                          paddingTop: 8,
                          display: 'grid',
                          gap: 6,
                        }}
                      >
                        {history.map((h) => (
                          <div
                            key={h.id}
                            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}
                          >
                            <span className="mono muted">v{h.version}</span>
                            <span>{h.title ?? '—'}</span>
                            <span className="muted">filed {formatDate(h.uploadedAt.slice(0, 10))}</span>
                            {h.supersededAt && (
                              <span className="muted">· replaced {formatDate(h.supersededAt.slice(0, 10))}</span>
                            )}
                            <span style={{ flex: 1 }} />
                            <button
                              className="btn quiet"
                              onClick={() => openDocument(h.id, (m) => toast(m, 'error'))}
                            >
                              Open
                            </button>
                            <button
                              className="btn"
                              disabled={pending && busy === h.id}
                              onClick={() => onDelete(h)}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
