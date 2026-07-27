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
import { deleteAsset } from '@/lib/actions/assets';
import type { AssetRow, EmployeeOption } from '@/lib/queries';

export function AssetsScreen({ assets, employees }: { assets: AssetRow[]; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [assigning, setAssigning] = useState<AssetRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((a) =>
      [a.desktop_name, a.brand, a.serial_no, a.model_no, a.device_id, a.product_id].some((v) =>
        (v ?? '').toLowerCase().includes(term),
      ),
    );
  }, [q, assets]);

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

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Desktop name</th>
                <th>Brand</th>
                <th>Serial no.</th>
                <th>Model</th>
                <th>Assigned to</th>
                <th>Warranty upto</th>
                <th>Processor</th>
                <th>RAM</th>
                <th>Storage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <b>{a.desktop_name}</b>
                  </td>
                  <td>{a.brand ?? '—'}</td>
                  <td className="mono">{a.serial_no ?? '—'}</td>
                  <td>{a.model_no ?? '—'}</td>
                  <td>
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
                  <td className="mono">{a.warranty_upto ?? '—'}</td>
                  <td>{a.processor ?? '—'}</td>
                  <td>{a.ram ?? '—'}</td>
                  <td>{a.storage ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
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
                  <td className="muted" colSpan={10} style={{ textAlign: 'center' }}>
                    {q ? `No assets match “${q}”.` : 'No assets yet.'}
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
