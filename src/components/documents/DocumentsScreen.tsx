'use client';

// The document register: the CURRENT version of every document the company
// holds, for every employee, with the verification queue in front of it.
//
// Filtering and sorting live in the column headers (ThMenu), matching Assets
// and Inventory — there is deliberately no separate filter bar.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import {
  ThMenu,
  distinctValues,
  sortRows,
  inDateRange,
  rangeActive,
  type SortDir,
  type ColKind,
  type DateRange,
} from '@/components/ui/ThMenu';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';
import { verifyEmployeeDocument, deleteEmployeeDocument } from '@/lib/actions/documents';
import { documentCategoryLabel } from '@/lib/constants';
import { UploadDocumentDrawer, type DrawerTarget } from './UploadDocumentDrawer';
import { EmployeeDocumentsPanel } from './EmployeeDocumentsPanel';
import { openDocument } from './openDocument';
import { StatusPill } from './StatusPill';
import type { DocumentStats, EmployeeDocumentRow, EmployeeOption } from '@/lib/queries';

type ColKey = 'employee' | 'category' | 'title' | 'source' | 'status' | 'filed';

const STATUS_TEXT: Record<string, string> = {
  verified: 'Verified',
  awaiting: 'Awaiting verification',
  returned: 'Returned',
  superseded: 'Superseded',
};

// `get` yields the string each header menu sorts and filters on; '—' stands in
// for blank so "no value" is itself pickable. `kind` picks the compare order —
// Filed is a date and must sort chronologically, not A → Z.
const COLS: { key: ColKey; label: string; kind?: ColKind; get: (d: EmployeeDocumentRow) => string }[] = [
  { key: 'employee', label: 'Employee', get: (d) => d.name || '—' },
  { key: 'category', label: 'Category', get: (d) => documentCategoryLabel(d.category, d.source === 'issued') },
  { key: 'title', label: 'Document', get: (d) => d.title ?? '—' },
  { key: 'source', label: 'Source', get: (d) => (d.source === 'issued' ? 'HR issued' : 'Uploaded') },
  { key: 'status', label: 'Status', get: (d) => STATUS_TEXT[d.status] ?? d.status },
  { key: 'filed', label: 'Filed', kind: 'date', get: (d) => d.uploadedAt.slice(0, 10) },
];

export function DocumentsScreen({
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
  // Date columns filter by range, not by ticking individual days.
  const [ranges, setRanges] = useState<Partial<Record<ColKey, DateRange>>>({});

  // Options come from the full register, not the filtered view, so a selection
  // in one column never hides another column's choices.
  const options = useMemo(() => {
    const out = {} as Record<ColKey, string[]>;
    for (const c of COLS) out[c.key] = distinctValues(register.map(c.get), c.kind);
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
    for (const c of COLS) {
      if (c.kind === 'date') {
        const r = ranges[c.key];
        if (rangeActive(r)) out = out.filter((d) => inDateRange(c.get(d), r));
        continue;
      }
      const sel = filters[c.key];
      if (sel?.length) out = out.filter((d) => sel.includes(c.get(d)));
    }
    if (sort) {
      const col = COLS.find((c) => c.key === sort.key);
      if (col) out = sortRows(out, col.get, col.kind ?? 'text', sort.dir);
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
      return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) toast(res.error ?? 'The action failed.', 'error');
      else {
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
    if (reason === null) return;
    run(d.id, () => verifyEmployeeDocument(d.id, false, reason.trim()), 'Returned to the employee.');
  }

  async function onDelete(d: EmployeeDocumentRow) {
    const ok = await confirm({
      title: 'Delete this document?',
      message: 'Any earlier version becomes current again. The file itself is kept.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    run(d.id, () => deleteEmployeeDocument(d.id), 'Document deleted.');
  }

  return (
    <div className="wrap">
      {confirmDialog}
      {promptDialog}
      {toastNode}

      <div className="emp-top">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Search employee, code, document…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          {rows.length} of {register.length}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setDrawer({ mode: 'upload' })}>
          + Upload document
        </button>
      </div>

      <div className="kpis five" style={{ marginBottom: 14 }}>
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
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="hd">
            <h3>Needs attention</h3>
            <span className="folio">{queue.length}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Filed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((d) => (
                  <tr key={d.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <EmployeeLink row={d} onOpen={setPanelFor} />{' '}
                      <span className="mono muted" style={{ fontSize: 11 }}>{d.code}</span>
                    </td>
                    <td>
                      {documentCategoryLabel(d.category)} — {d.title ?? '—'}
                      {d.version > 1 && <span className="muted"> · v{d.version}</span>}
                      {d.verifyRemark && (
                        <div style={{ fontSize: 11, color: 'var(--hd)' }}>
                          <b>Note:</b> {d.verifyRemark}
                        </div>
                      )}
                    </td>
                    <td><StatusPill row={d} /></td>
                    <td className="mono">{formatDate(d.uploadedAt.slice(0, 10))}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn quiet" onClick={() => openDocument(d.id, (m) => toast(m, 'error'))}>
                          📎 Open
                        </button>
                        <button
                          className="btn primary"
                          disabled={pending && busy === d.id}
                          onClick={() => run(d.id, () => verifyEmployeeDocument(d.id, true), 'Document verified.')}
                        >
                          ✓ Verify
                        </button>
                        <button className="btn" onClick={() => setDrawer({ mode: 'replace', document: d })}>
                          ⟳ Replace
                        </button>
                        <button className="btn" disabled={pending && busy === d.id} onClick={() => onReturn(d)}>
                          Return
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="hd">
          <h3>Document register</h3>
          <span className="folio">{rows.length}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 980 }}>
            <thead>
              <tr>
                {COLS.map((c) => (
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="muted" style={{ padding: 16 }}>
                    {register.length === 0
                      ? 'No documents on file yet. Upload one to start the register.'
                      : 'No documents match the current search or filters.'}
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <EmployeeLink row={d} onOpen={setPanelFor} />
                      <div className="mono muted" style={{ fontSize: 11 }}>{d.code}</div>
                    </td>
                    <td>{documentCategoryLabel(d.category, d.source === 'issued')}</td>
                    <td>
                      {d.title ?? '—'}
                      {d.version > 1 && <span className="muted"> · v{d.version}</span>}
                    </td>
                    <td>{d.source === 'issued' ? 'HR issued' : 'Uploaded'}</td>
                    <td><StatusPill row={d} /></td>
                    <td className="mono">{formatDate(d.uploadedAt.slice(0, 10))}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn quiet" onClick={() => openDocument(d.id, (m) => toast(m, 'error'))}>
                          📎
                        </button>
                        {d.status !== 'verified' && (
                          <button
                            className="btn primary"
                            disabled={pending && busy === d.id}
                            onClick={() => run(d.id, () => verifyEmployeeDocument(d.id, true), 'Document verified.')}
                          >
                            ✓
                          </button>
                        )}
                        {/* An HR-issued letter is reproduced from the exit case,
                            never replaced by an upload — see replaceEmployeeDocument. */}
                        {d.source === 'uploaded' && (
                          <button className="btn" onClick={() => setDrawer({ mode: 'replace', document: d })}>
                            ⟳ Replace
                          </button>
                        )}
                        <button
                          className="btn danger"
                          disabled={pending && busy === d.id}
                          onClick={() => onDelete(d)}
                        >
                          Delete
                        </button>
                      </div>
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

/**
 * The employee name as a button that opens their drill-down.
 *
 * Styled inline rather than with a class: it is the only link-shaped button in
 * the app, and globals.css has no rule for one — adding a global class for a
 * single use would be the wrong place to put it.
 */
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
