'use client';

// Asset Management (admin/HR). Lists IT assets with search, an add/edit drawer,
// and delete. The list rows carry every column, so editing reuses the in-memory
// row — no per-row fetch needed.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddAssetDrawer } from './AddAssetDrawer';
import { deleteAsset } from '@/lib/actions/assets';
import type { AssetRow } from '@/lib/queries';

export function AssetsScreen({ assets }: { assets: AssetRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  function onDelete(a: AssetRow) {
    if (!window.confirm(`Delete asset “${a.desktop_name}”? This cannot be undone.`)) return;
    setError(null);
    setBusyId(a.id);
    startTransition(async () => {
      const res = await deleteAsset(a.id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error ?? 'Could not delete the asset.');
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
                <th>Desktop name</th>
                <th>Brand</th>
                <th>Serial no.</th>
                <th>Model</th>
                <th>Warranty upto</th>
                <th>Processor</th>
                <th>RAM</th>
                <th>Storage</th>
                <th>Antivirus</th>
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
                  <td className="mono">{a.warranty_upto ?? '—'}</td>
                  <td>{a.processor ?? '—'}</td>
                  <td>{a.ram ?? '—'}</td>
                  <td>{a.storage ?? '—'}</td>
                  <td>{a.antivirus ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn quiet" onClick={() => openEdit(a)} disabled={pending && busyId === a.id}>
                        Edit
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
    </div>
  );
}
