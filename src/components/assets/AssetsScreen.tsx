'use client';

// Asset list with search, editing, assignment, and deletion. Editing uses the loaded row.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddAssetDrawer } from './AddAssetDrawer';
import { AssignAssetDrawer } from './AssignAssetDrawer';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { TableColumnMenu, getDistinctColumnValues, sortTableRows, isWithinDateRange, isDateRangeActive } from '@/components/ui/TableColumnMenu';
import { deleteAsset } from '@/lib/actions/assets';
import { inr } from '@/lib/display-formatting';
import type { SortDirection, ColumnDataType, DateRange } from '@/components/ui/TableColumnMenu';
import type { AssetRow, AssetSummaryRow } from '@/lib/queries/assets';
import type { EmployeeOption } from '@/lib/queries/employees';

/** Combine column filters with AND; selected values within a column use OR. */
type ColumnKey =
  | 'purchased'
  | 'cost'
  | 'name'
  | 'category'
  | 'brand'
  | 'serial'
  | 'model'
  | 'assigned'
  | 'warranty'
  | 'processor'
  | 'ram'
  | 'storage';

const columns: Array<{
  key: ColumnKey;
  label: string;
  kind?: ColumnDataType;
  get: (a: AssetRow) => string;
}> = [
  { key: 'purchased', label: 'Purchased on', kind: 'date', get: (a) => a.purchase_date ?? '—' },
  {
    key: 'cost',
    label: 'Purchase cost',
    kind: 'number',
    get: (a) => (a.purchase_cost == null ? '—' : String(a.purchase_cost)),
  },
  { key: 'name', label: 'Desktop name', get: (a) => a.desktop_name || '—' },
  { key: 'category', label: 'Category', get: (a) => a.asset_category ?? '—' },
  { key: 'brand', label: 'Brand', get: (a) => a.brand ?? '—' },
  { key: 'serial', label: 'Serial no.', get: (a) => a.serial_no ?? '—' },
  { key: 'model', label: 'Model', get: (a) => a.model_no ?? '—' },
  { key: 'assigned', label: 'Assigned to', get: (a) => a.assigned_person_name ?? '—' },
  { key: 'warranty', label: 'Warranty upto', kind: 'date', get: (a) => a.warranty_upto ?? '—' },
  { key: 'processor', label: 'Processor', get: (a) => a.processor ?? '—' },
  { key: 'ram', label: 'RAM', get: (a) => a.ram ?? '—' },
  { key: 'storage', label: 'Storage', get: (a) => a.storage ?? '—' },
];

function AssetsScreen({
  assets,
  employees,
  summary = [],
}: {
  assets: AssetRow[];
  employees: EmployeeOption[];
  summary?: AssetSummaryRow[];
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [assigning, setAssigning] = useState<AssetRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

  // Header-menu state: one active sort, plus per-column value selections and,
  // for date columns, a from/to range instead of those selections.
  const [sort, setSort] = useState<{ key: ColumnKey; dir: SortDirection } | null>(null);
  const [filters, setFilters] = useState<Partial<Record<ColumnKey, string[]>>>({});
  const [ranges, setRanges] = useState<Partial<Record<ColumnKey, DateRange>>>({});

  // Options come from the full list (not the filtered one), so a selection in
  // one column never hides another column's choices.
  const options = useMemo(() => {
    const out = {} as Record<ColumnKey, string[]>;
    for (const c of columns) {
      out[c.key] = getDistinctColumnValues(assets.map(c.get), c.kind);
    }
    return out;
  }, [assets]);

  const hasFilters =
    Object.values(filters).some((sel) => (sel?.length ?? 0) > 0) ||
    Object.values(ranges).some(isDateRangeActive);

  const filtered = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    let rows = assets;
    if (term) {
      rows = rows.filter((a) =>
        [a.desktop_name, a.brand, a.serial_no, a.model_no, a.device_id, a.product_id].some((v) =>
          (v ?? '').toLowerCase().includes(term),
        ),
      );
    }
    for (const c of columns) {
      if (c.kind === 'date') {
        const r = ranges[c.key];
        if (isDateRangeActive(r)) {
          rows = rows.filter((a) => isWithinDateRange(c.get(a), r));
        }
        continue;
      }
      const sel = filters[c.key];
      if (sel?.length) {
        rows = rows.filter((a) => sel.includes(c.get(a)));
      }
    }
    if (sort) {
      const selectedColumn = columns.find((c) => c.key === sort.key);
      if (selectedColumn) {
        rows = sortTableRows(rows, selectedColumn.get, selectedColumn.kind ?? 'text', sort.dir);
      }
    }
    return rows;
  }, [searchQuery, assets, filters, ranges, sort]);

  function toggleFilter(key: ColumnKey, value: string) {
    setFilters((f) => {
      const cur = f[key] ?? [];
      return {
        ...f,
        [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      };
    });
  }

  function openAdd() {
    setEditing(null);
    setDrawer(true);
  }

  function openEdit(a: AssetRow) {
    setEditing(a);
    setDrawer(true);
  }

  async function onDelete(a: AssetRow) {
    const ok = await confirm({
      title: 'Delete asset',
      message: `Delete “${a.desktop_name}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setBusyId(a.id);
    startTransition(async () => {
      const res = await deleteAsset(a.id);
      setBusyId(null);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not delete the asset.', 'error');
        return;
      }
      showNotification('Asset deleted.', 'success');
      router.refresh();
    });
  }

  return (
    <div className="content-container">
      <div className="records-toolbar">
        <div className="search-field">
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
            placeholder="Search name, serial, model…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <span
          className="status-badge"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
        >
          {assets.length} asset{assets.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="button primary" onClick={openAdd}>
          + Add asset
        </button>
      </div>

      {notificationContainer}

      {/* 14px below, matching .emp-top's own margin, so the search row, summary
          band and table card sit on one consistent vertical rhythm. */}
      {summary.length > 0 && (
        <div className="summary-cards" style={{ marginBottom: 14 }}>
          {summary.map((s) => (
            <div className="card summary-card" key={s.category}>
              <div className="metric-label">{s.category}</div>
              <div className="metric-value">{s.total}</div>
              <div className="metric-note">
                {s.assigned} assigned · {s.available} free
                {s.warranty_expiring > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    <span style={{ color: 'var(--attendance-late)' }}>
                      {s.warranty_expiring} warranty≤30d
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          {/* min-width keeps 12 columns from crushing into each other — below
              it the wrapper scrolls horizontally instead of misaligning. */}
          <table style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>
                    <TableColumnMenu
                      label={c.label}
                      kind={c.kind}
                      sortDirection={sort?.key === c.key ? sort.dir : null}
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
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td className="text-monospace" style={{ whiteSpace: 'nowrap' }}>
                    {a.purchase_date ?? '—'}
                  </td>
                  <td className="text-monospace text-right" style={{ whiteSpace: 'nowrap' }}>
                    {a.purchase_cost == null ? '—' : inr(a.purchase_cost)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{a.desktop_name}</b>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {a.asset_category ? (
                      <span
                        className="status-badge"
                        style={{
                          borderColor: 'var(--border-strong)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {a.asset_category}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <Trunc v={a.brand} w={110} />
                  </td>
                  <td className="text-monospace" style={{ whiteSpace: 'nowrap' }}>
                    {a.serial_no ?? '—'}
                  </td>
                  <td>
                    <Trunc v={a.model_no} w={140} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {a.assigned_employee_id ? (
                      <>
                        {a.assigned_person_name ?? '—'}{' '}
                        <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                          {a.assigned_employee_code ?? ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-monospace" style={{ whiteSpace: 'nowrap' }}>
                    {a.warranty_upto ?? '—'}
                  </td>
                  <td>
                    <Trunc v={a.processor} w={170} />
                  </td>
                  <td>
                    <Trunc v={a.ram} w={100} />
                  </td>
                  <td>
                    <Trunc v={a.storage} w={140} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                      <button
                        className="button quiet"
                        onClick={() => openEdit(a)}
                        disabled={pending && busyId === a.id}
                      >
                        Edit
                      </button>
                      <button
                        className="button quiet"
                        onClick={() => setAssigning(a)}
                        disabled={pending && busyId === a.id}
                        title="Assign this asset to an employee"
                      >
                        {a.assigned_employee_id ? 'Reassign' : 'Assign'}
                      </button>
                      <button
                        className="button quiet"
                        onClick={() => onDelete(a)}
                        disabled={pending && busyId === a.id}
                        title="Delete this asset"
                      >
                        {pending && busyId === a.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="text-muted" colSpan={11} style={{ textAlign: 'center' }}>
                    {searchQuery || hasFilters
                      ? 'No assets match the current search / filters.'
                      : 'No assets yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddAssetDrawer
        open={drawer}
        asset={editing}
        onClose={() => {
          setDrawer(false);
          setEditing(null);
        }}
      />
      <AssignAssetDrawer
        asset={assigning ? (assets.find((asset) => asset.id === assigning.id) ?? null) : null}
        employees={employees}
        onClose={() => setAssigning(null)}
      />
      {confirmDialog}
    </div>
  );
}

/**
 * One-line cell for free-text specs (processor, storage…): long values get an
 * ellipsis and a hover tooltip instead of wrapping, so every row stays one
 * line and columns keep their alignment with the headers.
 */
function Trunc({ v, w = 150 }: { v: string | null; w?: number }) {
  if (!v) {
    return <span className="text-muted">—</span>;
  }
  return (
    <span
      title={v}
      style={{
        display: 'inline-block',
        maxWidth: w,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
      }}
    >
      {v}
    </span>
  );
}

export { AssetsScreen };
