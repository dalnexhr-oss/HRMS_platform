'use client';

// Asset Management (admin/HR). Lists IT assets with search, an add/edit drawer,
// and delete. The list rows carry every column, so editing reuses the in-memory
// row — no per-row fetch needed.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddAssetDrawer } from './AddAssetDrawer';
import { AssignAssetDrawer } from './AssignAssetDrawer';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ThMenu, distinctValues, type SortDir } from '@/components/ui/ThMenu';
import { deleteAsset } from '@/lib/actions/assets';
import type { AssetRow, EmployeeOption, AssetSummaryRow } from '@/lib/queries';

// One entry per data column, in display order (Actions excluded). `get` yields
// the string each header menu sorts and filters on; '—' stands in for blank so
// "no value" is itself pickable in the filter.
type ColKey =
  | 'name' | 'category' | 'brand' | 'serial' | 'model'
  | 'assigned' | 'warranty' | 'processor' | 'ram' | 'storage';

const COLS: { key: ColKey; label: string; get: (a: AssetRow) => string }[] = [
  { key: 'name', label: 'Desktop name', get: (a) => a.desktop_name || '—' },
  { key: 'category', label: 'Category', get: (a) => a.asset_category ?? '—' },
  { key: 'brand', label: 'Brand', get: (a) => a.brand ?? '—' },
  { key: 'serial', label: 'Serial no.', get: (a) => a.serial_no ?? '—' },
  { key: 'model', label: 'Model', get: (a) => a.model_no ?? '—' },
  { key: 'assigned', label: 'Assigned to', get: (a) => a.assigned_person_name ?? '—' },
  { key: 'warranty', label: 'Warranty upto', get: (a) => a.warranty_upto ?? '—' },
  { key: 'processor', label: 'Processor', get: (a) => a.processor ?? '—' },
  { key: 'ram', label: 'RAM', get: (a) => a.ram ?? '—' },
  { key: 'storage', label: 'Storage', get: (a) => a.storage ?? '—' },
];

export function AssetsScreen({
  assets,
  employees,
  summary = [],
}: {
  assets: AssetRow[];
  employees: EmployeeOption[];
  summary?: AssetSummaryRow[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [assigning, setAssigning] = useState<AssetRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  // Header-menu state: one active sort, plus per-column value selections.
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir } | null>(null);
  const [filters, setFilters] = useState<Partial<Record<ColKey, string[]>>>({});

  // Options come from the full list (not the filtered one), so a selection in
  // one column never hides another column's choices.
  const options = useMemo(() => {
    const out = {} as Record<ColKey, string[]>;
    for (const c of COLS) out[c.key] = distinctValues(assets.map(c.get));
    return out;
  }, [assets]);

  const hasFilters = Object.values(filters).some((sel) => (sel?.length ?? 0) > 0);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let rows = assets;
    if (term) {
      rows = rows.filter((a) =>
        [a.desktop_name, a.brand, a.serial_no, a.model_no, a.device_id, a.product_id].some((v) =>
          (v ?? '').toLowerCase().includes(term),
        ),
      );
    }
    for (const c of COLS) {
      const sel = filters[c.key];
      if (sel?.length) rows = rows.filter((a) => sel.includes(c.get(a)));
    }
    if (sort) {
      const col = COLS.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        rows = [...rows].sort(
          (x, y) => dir * col.get(x).localeCompare(col.get(y), undefined, { numeric: true }),
        );
      }
    }
    return rows;
  }, [q, assets, filters, sort]);

  function toggleFilter(key: ColKey, value: string) {
    setFilters((f) => {
      const cur = f[key] ?? [];
      return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
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
    if (!ok) return;
    setBusyId(a.id);
    startTransition(async () => {
      const res = await deleteAsset(a.id);
      setBusyId(null);
      if (!res.ok) {
        toast(res.error ?? 'Could not delete the asset.', 'error');
        return;
      }
      toast('Asset deleted.', 'success');
      router.refresh();
    });
  }

  return (
    <div className="wrap">
      <div className="emp-top">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Search name, serial, model…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          {assets.length} asset{assets.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={openAdd}>
          + Add asset
        </button>
      </div>

      {toastNode}

      {/* 14px below, matching .emp-top's own margin, so the search row, summary
          band and table card sit on one consistent vertical rhythm. */}
      {summary.length > 0 && (
        <div className="kpis" style={{ marginBottom: 14 }}>
          {summary.map((s) => (
            <div className="card kpi" key={s.category}>
              <div className="lab">{s.category}</div>
              <div className="val">{s.total}</div>
              <div className="note">
                {s.assigned} assigned · {s.available} free
                {s.warranty_expiring > 0 && (
                  <> · <span style={{ color: 'var(--lm)' }}>{s.warranty_expiring} warranty≤30d</span></>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          {/* min-width keeps 11 columns from crushing into each other — below
              it the wrapper scrolls horizontally instead of misaligning. */}
          <table style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key}>
                    <ThMenu
                      label={c.label}
                      sortDir={sort?.key === c.key ? sort.dir : null}
                      onSort={(dir) => setSort(dir ? { key: c.key, dir } : null)}
                      options={options[c.key]}
                      selected={filters[c.key] ?? []}
                      onToggle={(v) => toggleFilter(c.key, v)}
                      onClear={() => setFilters((f) => ({ ...f, [c.key]: [] }))}
                    />
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{a.desktop_name}</b>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {a.asset_category ? (
                      <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
                        {a.asset_category}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Trunc v={a.brand} w={110} />
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {a.serial_no ?? '—'}
                  </td>
                  <td>
                    <Trunc v={a.model_no} w={140} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {a.assigned_employee_id ? (
                      <>
                        {a.assigned_person_name ?? '—'}{' '}
                        <span className="mono muted" style={{ fontSize: 11 }}>
                          {a.assigned_employee_code ?? ''}
                        </span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
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
                      <button className="btn quiet" onClick={() => openEdit(a)} disabled={pending && busyId === a.id}>
                        Edit
                      </button>
                      <button
                        className="btn quiet"
                        onClick={() => setAssigning(a)}
                        disabled={pending && busyId === a.id}
                        title="Assign this asset to an employee"
                      >
                        {a.assigned_employee_id ? 'Reassign' : 'Assign'}
                      </button>
                      <button
                        className="btn quiet"
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
                  <td className="muted" colSpan={11} style={{ textAlign: 'center' }}>
                    {q || hasFilters ? 'No assets match the current search / filters.' : 'No assets yet.'}
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
      <AssignAssetDrawer asset={assigning} employees={employees} onClose={() => setAssigning(null)} />
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
  if (!v) return <span className="muted">—</span>;
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
