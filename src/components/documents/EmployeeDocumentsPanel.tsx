'use client';

// Load the employee's full document history when the panel opens. Register rows only include
// current versions.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/display-formatting';
import { fetchEmployeeDocumentHistory, verifyEmployeeDocument, deleteEmployeeDocument } from '@/lib/actions/documents';
import { documentCategoryLabel, requiredDocumentCategories } from '@/lib/document-categories';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { openDocument } from './open-document';
import { StatusPill } from './StatusPill';
import type { EmployeeDocumentRow } from '@/lib/documents/document-summary';

// All versions of one document, current first.
interface DocumentChain {
  current: EmployeeDocumentRow;
  history: EmployeeDocumentRow[];
}

// Group versions by doc_group. During replacement, fall back to the newest row if the chain
// temporarily has no current version.
function toChains(rows: EmployeeDocumentRow[]): DocumentChain[] {
  const byGroup = new Map<string, EmployeeDocumentRow[]>();
  for (const r of rows) {
    const list = byGroup.get(r.docGroup);
    if (list) {
      list.push(r);
    } else {
      byGroup.set(r.docGroup, [r]);
    }
  }
  const chains: DocumentChain[] = [];
  for (const versions of byGroup.values()) {
    const ordered = [...versions].sort((a, b) => b.version - a.version);
    const current = ordered.find((v) => v.isCurrent) ?? ordered[0];
    chains.push({ current, history: ordered.filter((v) => v.id !== current.id) });
  }
  return chains.sort((a, b) => b.current.uploadedAt.localeCompare(a.current.uploadedAt));
}

function EmployeeDocumentsPanel({
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
  const { showNotification, notificationContainer } = useNotifications();

  useEffect(() => {
    let live = true;
    if (!employee) {
      setRows(null);
      return;
    }
    setRows(null);
    fetchEmployeeDocumentHistory(employee.id).then((r) => {
      if (live) {
        setRows(r);
      }
    });
    return () => {
      live = false;
    };
  }, [employee?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chains = rows ? toChains(rows) : [];
  const heldVerified = new Set(
    chains
      .filter((c) => c.current.status === 'verified' && c.current.category)
      .map((c) => c.current.category!),
  );
  const missing = requiredDocumentCategories.filter((c) => !heldVerified.has(c));

  function reload() {
    if (!employee) {
      return;
    }
    fetchEmployeeDocumentHistory(employee.id).then(setRows);
    router.refresh();
  }

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        showNotification(res.error ?? 'The action failed.', 'error');
      } else {
        showNotification(okMsg, 'success');
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
    if (reason === null) {
      return;
    }
    run(
      d.id,
      () => verifyEmployeeDocument(d.id, false, reason.trim()),
      'Returned to the employee.',
    );
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
    if (!ok) {
      return;
    }
    run(d.id, () => deleteEmployeeDocument(d.id), 'Version deleted.');
  }

  const open = employee !== null;

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside
        className={`drawer${open ? ' is-active' : ''}`}
        aria-label={employee ? `Documents for ${employee.name}` : 'Employee documents'}
      >
        {confirmDialog}
        {promptDialog}
        {notificationContainer}

        <div className="drawer-header">
          <h3>
            {employee?.name}{' '}
            <span className="text-monospace text-muted" style={{ fontSize: 12 }}>
              {employee?.code}
            </span>
          </h3>
          <span style={{ flex: 1 }} />
          <button className="button quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="button primary"
              disabled={!employee}
              onClick={() => employee && onUpload(employee.id)}
            >
              + Upload for {employee ? employee.name.split(' ')[0] : 'employee'}
            </button>
            <span style={{ flex: 1 }} />
            <span
              className="status-badge"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
            >
              {chains.length} document{chains.length === 1 ? '' : 's'}
            </span>
          </div>

          {missing.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--attendance-late)' }}>
              <div className="card-body">
                <b style={{ color: 'var(--attendance-late)' }}>
                  Missing {missing.length} required document
                  {missing.length === 1 ? '' : 's'}
                </b>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {missing.map((c) => documentCategoryLabel(c)).join(' · ')}
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  A document counts as held once it is <b>verified</b> — one that is awaiting
                  verification or has been returned still shows as missing.
                </div>
              </div>
            </div>
          )}

          {rows === null ? (
            <p className="text-muted" style={{ margin: 0 }}>
              Loading…
            </p>
          ) : chains.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              Nothing on file for this employee yet.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {chains.map(({ current, history }) => (
                <div className="card" key={current.docGroup}>
                  <div className="card-body" style={{ display: 'grid', gap: 8 }}>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
                    >
                      <b>{documentCategoryLabel(current.category, current.source === 'issued')}</b>
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        {current.title ?? '—'}
                      </span>
                      <span style={{ flex: 1 }} />
                      <StatusPill row={current} />
                    </div>

                    <div className="text-muted" style={{ fontSize: 11 }}>
                      v{current.version} · filed {formatDate(current.uploadedAt.slice(0, 10))}
                      {current.source === 'issued' && ' · issued by HR'}
                      {current.verifiedAt &&
                        ` · verified ${formatDate(current.verifiedAt.slice(0, 10))}`}
                    </div>

                    {current.verifyRemark && (
                      <div style={{ fontSize: 12, color: 'var(--attendance-half-day)' }}>
                        <b>Note:</b> {current.verifyRemark}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className="button quiet"
                        onClick={() =>
                          openDocument(current.id, (m) => showNotification(m, 'error'))
                        }
                      >
                        📎 Open
                      </button>
                      {current.status !== 'verified' && (
                        <button
                          className="button primary"
                          disabled={pending && busy === current.id}
                          onClick={() =>
                            run(
                              current.id,
                              () => verifyEmployeeDocument(current.id, true),
                              'Document verified.',
                            )
                          }
                        >
                          ✓ Verify
                        </button>
                      )}
                      {current.source === 'uploaded' && (
                        <>
                          <button className="button" onClick={() => onReplace(current)}>
                            ⟳ Replace
                          </button>
                          <button
                            className="button"
                            disabled={pending && busy === current.id}
                            onClick={() => onReturn(current)}
                          >
                            Return
                          </button>
                        </>
                      )}
                      <button
                        className="button danger"
                        disabled={pending && busy === current.id}
                        onClick={() => onDelete(current)}
                      >
                        Delete
                      </button>
                      {history.length > 0 && (
                        <button
                          className="button quiet"
                          onClick={() =>
                            setExpanded(expanded === current.docGroup ? null : current.docGroup)
                          }
                        >
                          {expanded === current.docGroup ? 'Hide' : 'History'} ({history.length})
                        </button>
                      )}
                    </div>

                    {expanded === current.docGroup && history.length > 0 && (
                      <div
                        style={{
                          borderTop: '1px solid var(--border-subtle)',
                          paddingTop: 8,
                          display: 'grid',
                          gap: 6,
                        }}
                      >
                        {history.map((h) => (
                          <div
                            key={h.id}
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              fontSize: 12,
                            }}
                          >
                            <span className="text-monospace text-muted">v{h.version}</span>
                            <span>{h.title ?? '—'}</span>
                            <span className="text-muted">
                              filed {formatDate(h.uploadedAt.slice(0, 10))}
                            </span>
                            {h.supersededAt && (
                              <span className="text-muted">
                                · replaced {formatDate(h.supersededAt.slice(0, 10))}
                              </span>
                            )}
                            <span style={{ flex: 1 }} />
                            <button
                              className="button quiet"
                              onClick={() =>
                                openDocument(h.id, (m) => showNotification(m, 'error'))
                              }
                            >
                              Open
                            </button>
                            <button
                              className="button"
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

export { EmployeeDocumentsPanel };
