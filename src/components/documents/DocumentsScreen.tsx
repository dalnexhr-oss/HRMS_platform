'use client';

// Current employee documents and their verification queue. Header menus share the table filtering
// and sorting pattern.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { ThMenu, distinctValues, sortRows, inDateRange, rangeActive } from '@/components/ui/ThMenu';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';
import { verifyEmployeeDocument, deleteEmployeeDocument } from '@/lib/actions/documents';
import { documentCategoryLabel } from '@/lib/constants';
import { UploadDocumentDrawer } from './UploadDocumentDrawer';
import { EmployeeDocumentsPanel } from './EmployeeDocumentsPanel';
import { openDocument } from './open-document';
import { StatusPill } from './StatusPill';
import { DocumentActions } from './DocumentActions';
import type { DrawerTarget } from './UploadDocumentDrawer';
import type { SortDir, ColKind, DateRange } from '@/components/ui/ThMenu';
import type { DocumentStats, EmployeeDocumentRow, EmployeeOption } from '@/lib/queries';

type ColKey = 'employee' | 'category' | 'title' | 'source' | 'status' | 'filed';

const statusText: Record<string, string> = {
  verified: 'Verified',
  awaiting: 'Awaiting verification',
  returned: 'Returned',
  superseded: 'Superseded',
};

/** Combine column filters with AND; selected values within a column use OR. */
const cols: Array<{
  key: ColKey;
  label: string;
  kind?: ColKind;
  get: (d: EmployeeDocumentRow) => string;
}> = [
  { key: 'employee', label: 'Employee', get: (d) => d.name || '—' },
  {
    key: 'category',
    label: 'Category',
    get: (d) => documentCategoryLabel(d.category, d.source === 'issued'),
  },
  { key: 'title', label: 'Document', get: (d) => d.title ?? '—' },
  {
    key: 'source',
    label: 'Source',
    get: (d) => (d.source === 'issued' ? 'HR issued' : 'Uploaded'),
  },
  { key: 'status', label: 'Status', get: (d) => statusText[d.status] ?? d.status },
  { key: 'filed', label: 'Filed', kind: 'date', get: (d) => d.uploadedAt.slice(0, 10) },
];

function DocumentsScreen({
  register,
  stats,
  employees,
}: {
  register: EmployeeDocumentRow[];
  stats: DocumentStats;
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [panelFor, setPanelFor] = useState<{ id: string; code: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();
  const { toast, toastNode } = useToast();

  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir } | null>(null);
  const [filters, setFilters] = useState<Partial<Record<ColKey, string[]>>>({});
  const [ranges, setRanges] = useState<Partial<Record<ColKey, DateRange>>>({});

  // The distinct values for each column, used to populate the filter menus. Recomputed whenever
  // the register changes, which is only when the page is refreshed.
  const options = useMemo(() => {
    const out = {} as Record<ColKey, string[]>;
    for (const c of cols) {
      out[c.key] = distinctValues(register.map(c.get), c.kind);
    }
    return out;
  }, [register]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = register;
    if (term) {
      out = out.filter((d) =>
        [d.name, d.code, d.title, d.category].some((v) => (v ?? '').toLowerCase().includes(term)),
      );
    }
    for (const c of cols) {
      if (c.kind === 'date') {
        const r = ranges[c.key];
        if (rangeActive(r)) {
          out = out.filter((d) => inDateRange(c.get(d), r));
        }
        continue;
      }
      const sel = filters[c.key];
      if (sel?.length) {
        out = out.filter((d) => sel.includes(c.get(d)));
      }
    }
    if (sort) {
      const col = cols.find((c) => c.key === sort.key);
      if (col) {
        out = sortRows(out, col.get, col.kind ?? 'text', sort.dir);
      }
    }
    return out;
  }, [q, register, filters, ranges, sort]);

  const queue = useMemo(
    () => register.filter((d) => d.status === 'awaiting' || d.status === 'returned'),
    [register],
  );

  function toggleFilter(key: ColKey, value: string) {
    setFilters((f) => {
      const cur = f[key] ?? [];
      return {
        ...f,
        [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      };
    });
  }

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        toast(res.error ?? 'The action failed.', 'error');
      } else {
        toast(okMsg, 'success');
        router.refresh();
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
      title: 'Delete this document?',
      message: 'Any earlier version becomes current again. The file itself is kept.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    run(d.id, () => deleteEmployeeDocument(d.id), 'Document deleted.');
  }

  return (
    <div className="wrap documents-screen">
      {confirmDialog}
      {promptDialog}
      {toastNode}

      <div className="emp-top documents-toolbar">
        <div className="search">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="search"
            aria-label="Search employee documents"
            placeholder="Search employee, code, document…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          {rows.length} of {register.length}
        </span>
        <button className="btn primary" onClick={() => setDrawer({ mode: 'upload' })}>
          + Upload document
        </button>
      </div>

      <div className="kpis five documents-kpis">
        <div className="card kpi">
          <div className="lab">On file</div>
          <div className="val">{stats.total}</div>
          <div className="note">current versions, all employees</div>
        </div>
        <div className="card kpi">
          <div className="lab">Awaiting verification</div>
          <div className="val" style={{ color: stats.awaiting ? 'var(--lm)' : undefined }}>
            {stats.awaiting}
          </div>
          <div className="note">filed, not yet checked</div>
        </div>
        <div className="card kpi">
          <div className="lab">Returned</div>
          <div className="val" style={{ color: stats.returned ? 'var(--hd)' : undefined }}>
            {stats.returned}
          </div>
          <div className="note">sent back, awaiting a replacement</div>
        </div>
        <div className="card kpi">
          <div className="lab">HR issued</div>
          <div className="val">{stats.issued}</div>
          <div className="note">relieving · experience · F&amp;F</div>
        </div>
        <div className="card kpi">
          <div className="lab">Missing</div>
          <div className="val" style={{ color: stats.missing ? 'var(--lm)' : undefined }}>
            {stats.missing}
          </div>
          <div className="note">
            required docs across {stats.employeesMissing} employee
            {stats.employeesMissing === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {queue.length > 0 && (
        <div className="card documents-card documents-queue">
          <div className="hd">
            <h3>
              Needs attention (<span style={{ color: 'red' }}>{queue.length}</span>)
            </h3>
          </div>
          <div className="documents-table-wrap">
            <table
              className="documents-table documents-queue-table"
              aria-label="Documents needing attention"
            >
              <colgroup>
                <col className="documents-col-employee" />
                <col />
                <col className="documents-col-status" />
                <col className="documents-col-filed" />
                <col className="documents-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Filed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Employee">
                      <EmployeeLink row={d} onOpen={setPanelFor} />
                      <span className="document-employee-code mono muted">{d.code}</span>
                    </td>
                    <td data-label="Document" className="document-title-cell">
                      {documentCategoryLabel(d.category)} — {d.title ?? '—'}
                      {d.version > 1 && <span className="muted"> · v{d.version}</span>}
                      {d.verifyRemark && (
                        <div style={{ fontSize: 11, color: 'var(--hd)' }}>
                          <b>Note:</b> {d.verifyRemark}
                        </div>
                      )}
                    </td>
                    <td data-label="Status">
                      <StatusPill row={d} />
                    </td>
                    <td data-label="Filed" className="document-filed mono">
                      {formatDate(d.uploadedAt.slice(0, 10))}
                    </td>
                    <td data-label="Actions" className="document-actions-cell">
                      <DocumentActions
                        title={d.title ?? documentCategoryLabel(d.category)}
                        busy={pending && busy === d.id}
                        onOpen={() => openDocument(d.id, (m) => toast(m, 'error'))}
                        onVerify={() =>
                          run(d.id, () => verifyEmployeeDocument(d.id, true), 'Document verified.')
                        }
                        onReplace={() => setDrawer({ mode: 'replace', document: d })}
                        onReturn={() => onReturn(d)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card documents-card">
        <div className="hd">
          <h3>
            Document register (<span style={{ color: 'var(--brand)' }}>{rows.length}</span>)
          </h3>
        </div>
        <div className="documents-table-wrap">
          <table className="documents-table" aria-label="Document register">
            <colgroup>
              <col className="documents-col-employee" />
              <col className="documents-col-category" />
              <col />
              <col className="documents-col-source" />
              <col className="documents-col-status" />
              <col className="documents-col-filed" />
              <col className="documents-col-actions" />
            </colgroup>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key}>
                    <ThMenu
                      label={c.label}
                      kind={c.kind}
                      sortDir={sort?.key === c.key ? sort.dir : null}
                      onSort={(dir) => setSort(dir ? { key: c.key, dir } : null)}
                      options={options[c.key]}
                      selected={filters[c.key] ?? []}
                      onToggle={(v) => toggleFilter(c.key, v)}
                      onClear={() => setFilters((f) => ({ ...f, [c.key]: [] }))}
                      range={ranges[c.key]}
                      onRange={(r) => setRanges((s) => ({ ...s, [c.key]: r }))}
                    />
                  </th>
                ))}
                <th className="document-actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 1} className="muted documents-empty">
                    {register.length === 0
                      ? 'No documents on file yet. Upload one to start the register.'
                      : 'No documents match the current search or filters.'}
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Employee">
                      <EmployeeLink row={d} onOpen={setPanelFor} />
                      <div className="document-employee-code mono muted">{d.code}</div>
                    </td>
                    <td data-label="Category">
                      {documentCategoryLabel(d.category, d.source === 'issued')}
                    </td>
                    <td data-label="Document" className="document-title-cell">
                      {d.title ?? '—'}
                      {d.version > 1 && <span className="muted"> · v{d.version}</span>}
                    </td>
                    <td data-label="Source">{d.source === 'issued' ? 'HR issued' : 'Uploaded'}</td>
                    <td data-label="Status">
                      <StatusPill row={d} />
                    </td>
                    <td data-label="Filed" className="document-filed mono">
                      {formatDate(d.uploadedAt.slice(0, 10))}
                    </td>
                    <td data-label="Actions" className="document-actions-cell">
                      <DocumentActions
                        title={d.title ?? documentCategoryLabel(d.category, d.source === 'issued')}
                        busy={pending && busy === d.id}
                        onOpen={() => openDocument(d.id, (m) => toast(m, 'error'))}
                        onVerify={
                          d.status !== 'verified'
                            ? () =>
                                run(
                                  d.id,
                                  () => verifyEmployeeDocument(d.id, true),
                                  'Document verified.',
                                )
                            : undefined
                        }
                        // HR-issued letters are regenerated from the exit case, never replaced by upload.
                        onReplace={
                          d.source === 'uploaded'
                            ? () => setDrawer({ mode: 'replace', document: d })
                            : undefined
                        }
                        onDelete={() => onDelete(d)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <UploadDocumentDrawer target={drawer} employees={employees} onClose={() => setDrawer(null)} />

      <EmployeeDocumentsPanel
        employee={panelFor}
        onClose={() => setPanelFor(null)}
        onReplace={(doc) => setDrawer({ mode: 'replace', document: doc })}
        onUpload={(employeeId) => setDrawer({ mode: 'upload', employeeId })}
      />
    </div>
  );
}

function EmployeeLink({
  row,
  onOpen,
}: {
  row: EmployeeDocumentRow;
  onOpen: (e: { id: string; code: string; name: string }) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen({ id: row.employeeId, code: row.code, name: row.name })}
      title="Show every document for this employee"
      style={{
        background: 'none',
        border: 0,
        padding: 0,
        font: 'inherit',
        fontWeight: 700,
        color: 'var(--brand)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {row.name}
    </button>
  );
}

export { DocumentsScreen };
