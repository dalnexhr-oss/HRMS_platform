'use client';

// Item Management (admin/HR). Inventory list with derived Assigned/Remaining,
// an add/edit drawer, an assign drawer (with the item's assignment log), and
// delete. Mirrors AssetsScreen.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddItemDrawer } from './AddItemDrawer';
import { AssignItemDrawer } from './AssignItemDrawer';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ThMenu, distinctValues, sortRows, type SortDir, type ColKind } from '@/components/ui/ThMenu';
import { deleteItem } from '@/lib/actions/items';
import type { ItemRow, EmployeeOption } from '@/lib/queries';

// One entry per data column, in display order (Actions excluded). `get` yields
// the string each header menu sorts and filters on; '—' stands in for blank so
// "no value" is itself pickable in the filter. Quantity columns sort/filter on
// their numbers (low → high) and keep the right-aligned header.
type ColKey =
  | 'code' | 'name' | 'category' | 'brand' | 'size' | 'unit'
  | 'total' | 'assigned' | 'remaining' | 'status' | 'returnable';

const COLS: { key: ColKey; label: string; get: (i: ItemRow) => string; kind?: ColKind }[] = [
  { key: 'code', label: 'Material / Tool ID', get: (i) => i.item_code ?? '—' },
  { key: 'name', label: 'Name', get: (i) => i.item_name || '—' },
  { key: 'category', label: 'Category', get: (i) => i.category ?? '—' },
  { key: 'brand', label: 'Brand', get: (i) => i.brand ?? '—' },
  { key: 'size', label: 'Size / spec', get: (i) => i.size_spec ?? '—' },
  { key: 'unit', label: 'Unit', get: (i) => i.unit ?? '—' },
  { key: 'total', label: 'Total', get: (i) => String(i.total_quantity), kind: 'number' },
  { key: 'assigned', label: 'Assigned', get: (i) => String(i.quantity_assigned), kind: 'number' },
  { key: 'remaining', label: 'Remaining', get: (i) => String(i.quantity_remaining), kind: 'number' },
  { key: 'status', label: 'Status', get: (i) => i.status || '—' },
  { key: 'returnable', label: 'Returnable', get: (i) => (i.returnable ? 'Yes' : 'No') },
];

export function ItemsScreen({ items, employees }: { items: ItemRow[]; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [editDrawer, setEditDrawer] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [assignFor, setAssignFor] = useState<ItemRow | null>(null);
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
    for (const c of COLS) out[c.key] = distinctValues(items.map(c.get), c.kind);
    return out;
  }, [items]);

  const hasFilters = Object.values(filters).some((sel) => (sel?.length ?? 0) > 0);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let rows = items;
    if (term) {
      rows = rows.filter((i) =>
        [i.item_name, i.item_code, i.category, i.brand].some((v) => (v ?? '').toLowerCase().includes(term)),
      );
    }
    for (const c of COLS) {
      const sel = filters[c.key];
      if (sel?.length) rows = rows.filter((i) => sel.includes(c.get(i)));
    }
    if (sort) {
      const col = COLS.find((c) => c.key === sort.key);
      if (col) rows = sortRows(rows, col.get, col.kind ?? 'text', sort.dir);
    }
    return rows;
  }, [q, items, filters, sort]);

  function toggleFilter(key: ColKey, value: string) {
    setFilters((f) => {
      const cur = f[key] ?? [];
      return { ...f, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  function openAdd() {
    setEditing(null);
    setEditDrawer(true);
  }
  function openEdit(i: ItemRow) {
    setEditing(i);
    setEditDrawer(true);
  }

  async function onDelete(i: ItemRow) {
    const ok = await confirm({
      title: 'Delete material / tool',
      message: `Delete “${i.item_name}” and all its assignments? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusyId(i.id);
    startTransition(async () => {
      const res = await deleteItem(i.id);
      setBusyId(null);
      if (!res.ok) {
        toast(res.error ?? 'Could not delete the material / tool.', 'error');
        return;
      }
      toast('Material / tool deleted.', 'success');
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
          <input placeholder="Search name, code, category…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          {items.length} item{items.length === 1 ? '' : 's'} · materials &amp; tools
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={openAdd}>
          + Add material / tool
        </button>
      </div>

      {toastNode}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          {/* min-width keeps 12 columns from crushing into each other — below
              it the wrapper scrolls horizontally instead of misaligning. */}
          <table style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className={c.kind === 'number' ? 'right' : undefined}>
                    <ThMenu
                      label={c.label}
                      kind={c.kind}
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
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>
                    {i.item_code ?? '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{i.item_name}</b>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.category ?? '—'}</td>
                  <td>
                    <Trunc v={i.brand} w={110} />
                  </td>
                  <td>
                    <Trunc v={i.size_spec} w={130} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.unit ?? '—'}</td>
                  <td className="right mono">{i.total_quantity}</td>
                  <td className="right mono">{i.quantity_assigned}</td>
                  <td className="right mono">
                    <b>{i.quantity_remaining}</b>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.status}</td>
                  <td>{i.returnable ? 'Yes' : 'No'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                      <button
                        className="btn quiet"
                        onClick={() => setAssignFor(i)}
                        disabled={i.quantity_remaining <= 0}
                        title={i.quantity_remaining <= 0 ? 'Nothing left to assign' : 'Assign to an employee'}
                      >
                        Assign
                      </button>
                      <button className="btn quiet" onClick={() => openEdit(i)}>
                        Edit
                      </button>
                      <button
                        className="btn quiet"
                        onClick={() => onDelete(i)}
                        disabled={pending && busyId === i.id}
                        title="Delete this item"
                      >
                        {pending && busyId === i.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="muted" colSpan={12} style={{ textAlign: 'center' }}>
                    {q || hasFilters
                      ? 'No materials or tools match the current search / filters.'
                      : 'No materials or tools yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddItemDrawer
        open={editDrawer}
        item={editing}
        onClose={() => {
          setEditDrawer(false);
          setEditing(null);
        }}
      />

      <AssignItemDrawer
        item={assignFor}
        employees={employees}
        onClose={() => setAssignFor(null)}
      />
      {confirmDialog}
    </div>
  );
}

/**
 * One-line cell for free-text fields (brand, size/spec): long values get an
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
