'use client';

// Item Management (admin/HR). Inventory list with derived Assigned/Remaining,
// an add/edit drawer, an assign drawer (with the item's assignment log), and
// delete. Mirrors AssetsScreen.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddItemDrawer } from './AddItemDrawer';
import { AssignItemDrawer } from './AssignItemDrawer';
import { deleteItem } from '@/lib/actions/items';
import type { ItemRow, EmployeeOption } from '@/lib/queries';

export function ItemsScreen({ items, employees }: { items: ItemRow[]; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [editDrawer, setEditDrawer] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [assignFor, setAssignFor] = useState<ItemRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((i) =>
      [i.item_name, i.item_code, i.category, i.brand].some((v) => (v ?? '').toLowerCase().includes(term)),
    );
  }, [q, items]);

  function openAdd() {
    setEditing(null);
    setEditDrawer(true);
  }
  function openEdit(i: ItemRow) {
    setEditing(i);
    setEditDrawer(true);
  }

  function onDelete(i: ItemRow) {
    if (!window.confirm(`Delete item “${i.item_name}” and all its assignments? This cannot be undone.`)) return;
    setError(null);
    setBusyId(i.id);
    startTransition(async () => {
      const res = await deleteItem(i.id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error ?? 'Could not delete the item.');
        return;
      }
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
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={openAdd}>
          + Add item
        </button>
      </div>

      {error && (
        <div className="login-error" style={{ margin: '0 0 12px' }}>
          {error}
        </div>
      )}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Item ID</th>
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
                    {q ? `No items match “${q}”.` : 'No items yet.'}
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
    </div>
  );
}
