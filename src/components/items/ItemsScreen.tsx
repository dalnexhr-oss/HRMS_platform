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
import { FilterSelect, distinctOptions } from '@/components/ui/FilterSelect';
import { deleteItem } from '@/lib/actions/items';
import type { ItemRow, EmployeeOption } from '@/lib/queries';

/** One dropdown per headline column. '' = All (no filtering on that column). */
interface ItemFilters {
  code: string;
  name: string;
  category: string;
  brand: string;
  size: string;
  unit: string;
  status: string;
  returnable: string; // '' | 'Yes' | 'No'
  stock: string; //      '' | 'In stock' | 'Fully assigned'
}

const NO_ITEM_FILTERS: ItemFilters = {
  code: '', name: '', category: '', brand: '', size: '', unit: '', status: '', returnable: '', stock: '',
};

export function ItemsScreen({ items, employees }: { items: ItemRow[]; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<ItemFilters>(NO_ITEM_FILTERS);
  const [editDrawer, setEditDrawer] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [assignFor, setAssignFor] = useState<ItemRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  const set = (k: keyof ItemFilters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const anyFilter = Object.values(filters).some(Boolean);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      if (
        term &&
        ![i.item_name, i.item_code, i.category, i.brand].some((v) =>
          (v ?? '').toLowerCase().includes(term),
        )
      ) {
        return false;
      }
      if (filters.code && (i.item_code ?? '') !== filters.code) return false;
      if (filters.name && i.item_name !== filters.name) return false;
      if (filters.category && (i.category ?? '') !== filters.category) return false;
      if (filters.brand && (i.brand ?? '') !== filters.brand) return false;
      if (filters.size && (i.size_spec ?? '') !== filters.size) return false;
      if (filters.unit && (i.unit ?? '') !== filters.unit) return false;
      if (filters.status && i.status !== filters.status) return false;
      if (filters.returnable && (i.returnable ? 'Yes' : 'No') !== filters.returnable) return false;
      if (filters.stock === 'In stock' && i.quantity_remaining <= 0) return false;
      if (filters.stock === 'Fully assigned' && i.quantity_remaining > 0) return false;
      return true;
    });
  }, [q, items, filters]);

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

      {/* one dropdown per headline column — filters combine (AND) with search */}
      <div
        className="card"
        style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}
      >
        <FilterSelect label="Material / Tool ID" value={filters.code} options={distinctOptions(items.map((i) => i.item_code))} onChange={set('code')} />
        <FilterSelect label="Name" value={filters.name} options={distinctOptions(items.map((i) => i.item_name))} onChange={set('name')} />
        <FilterSelect label="Category" value={filters.category} options={distinctOptions(items.map((i) => i.category))} onChange={set('category')} />
        <FilterSelect label="Brand" value={filters.brand} options={distinctOptions(items.map((i) => i.brand))} onChange={set('brand')} />
        <FilterSelect label="Size / spec" value={filters.size} options={distinctOptions(items.map((i) => i.size_spec))} onChange={set('size')} />
        <FilterSelect label="Unit" value={filters.unit} options={distinctOptions(items.map((i) => i.unit))} onChange={set('unit')} />
        <FilterSelect label="Status" value={filters.status} options={distinctOptions(items.map((i) => i.status))} onChange={set('status')} />
        <FilterSelect label="Returnable" value={filters.returnable} options={['Yes', 'No']} onChange={set('returnable')} />
        <FilterSelect label="Stock" value={filters.stock} options={['In stock', 'Fully assigned']} onChange={set('stock')} />
        {anyFilter && (
          <button className="btn quiet" onClick={() => setFilters(NO_ITEM_FILTERS)}>
            Clear filters
          </button>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {filtered.length} of {items.length} shown
        </span>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Material / Tool ID</th>
                <th>Name</th>
                <th>Category</th>
                <th>Brand</th>
                <th>Size / spec</th>
                <th>Unit</th>
                <th className="right">Total</th>
                <th className="right">Assigned</th>
                <th className="right">Remaining</th>
                <th>Status</th>
                <th>Returnable</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="mono muted">{i.item_code ?? '—'}</td>
                  <td>
                    <b>{i.item_name}</b>
                  </td>
                  <td>{i.category ?? '—'}</td>
                  <td>{i.brand ?? '—'}</td>
                  <td>{i.size_spec ?? '—'}</td>
                  <td>{i.unit ?? '—'}</td>
                  <td className="right mono">{i.total_quantity}</td>
                  <td className="right mono">{i.quantity_assigned}</td>
                  <td className="right mono">
                    <b>{i.quantity_remaining}</b>
                  </td>
                  <td>{i.status}</td>
                  <td>{i.returnable ? 'Yes' : 'No'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
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
                    {q || anyFilter
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
