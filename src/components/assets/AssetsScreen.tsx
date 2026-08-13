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
import { FilterSelect, distinctOptions } from '@/components/ui/FilterSelect';
import { deleteAsset } from '@/lib/actions/assets';
import type { AssetRow, EmployeeOption, AssetSummaryRow } from '@/lib/queries';

/** One dropdown per headline column. '' = All (no filtering on that column). */
interface AssetFilters {
  name: string;
  category: string;
  brand: string;
  serial: string;
  model: string;
  assignee: string; // employee name or 'Unassigned'
  warranty: string; // '' | 'In warranty' | 'Expiring ≤ 30 days' | 'Expired' | 'No date'
  processor: string;
  ram: string;
  storage: string;
}

const NO_ASSET_FILTERS: AssetFilters = {
  name: '', category: '', brand: '', serial: '', model: '', assignee: '', warranty: '',
  processor: '', ram: '', storage: '',
};

const UNASSIGNED = 'Unassigned';

/** Bucket a warranty_upto date for the Warranty dropdown. */
function warrantyBucket(warrantyUpto: string | null, todayISO: string): string {
  if (!warrantyUpto) return 'No date';
  if (warrantyUpto < todayISO) return 'Expired';
  const soon = new Date(`${todayISO}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  if (warrantyUpto <= soon.toISOString().slice(0, 10)) return 'Expiring ≤ 30 days';
  return 'In warranty';
}

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
  const [filters, setFilters] = useState<AssetFilters>(NO_ASSET_FILTERS);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [assigning, setAssigning] = useState<AssetRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  const set = (k: keyof AssetFilters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const anyFilter = Object.values(filters).some(Boolean);
  // One render's worth of "today" — the buckets must agree between options and rows.
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return assets.filter((a) => {
      if (
        term &&
        ![a.desktop_name, a.brand, a.serial_no, a.model_no, a.device_id, a.product_id].some((v) =>
          (v ?? '').toLowerCase().includes(term),
        )
      ) {
        return false;
      }
      if (filters.name && a.desktop_name !== filters.name) return false;
      if (filters.category && (a.asset_category ?? '') !== filters.category) return false;
      if (filters.brand && (a.brand ?? '') !== filters.brand) return false;
      if (filters.serial && (a.serial_no ?? '') !== filters.serial) return false;
      if (filters.model && (a.model_no ?? '') !== filters.model) return false;
      if (filters.assignee) {
        const holder = a.assigned_employee_id ? (a.assigned_person_name ?? '') : UNASSIGNED;
        if (holder !== filters.assignee) return false;
      }
      if (filters.warranty && warrantyBucket(a.warranty_upto, todayISO) !== filters.warranty) return false;
      if (filters.processor && (a.processor ?? '') !== filters.processor) return false;
      if (filters.ram && (a.ram ?? '') !== filters.ram) return false;
      if (filters.storage && (a.storage ?? '') !== filters.storage) return false;
      return true;
    });
  }, [q, assets, filters, todayISO]);

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

      {/* one dropdown per headline column — filters combine (AND) with search */}
      <div
        className="card"
        style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}
      >
        <FilterSelect label="Desktop name" value={filters.name} options={distinctOptions(assets.map((a) => a.desktop_name))} onChange={set('name')} />
        <FilterSelect label="Category" value={filters.category} options={distinctOptions(assets.map((a) => a.asset_category))} onChange={set('category')} />
        <FilterSelect label="Brand" value={filters.brand} options={distinctOptions(assets.map((a) => a.brand))} onChange={set('brand')} />
        <FilterSelect label="Serial no." value={filters.serial} options={distinctOptions(assets.map((a) => a.serial_no))} onChange={set('serial')} />
        <FilterSelect label="Model" value={filters.model} options={distinctOptions(assets.map((a) => a.model_no))} onChange={set('model')} />
        <FilterSelect
          label="Assigned to"
          value={filters.assignee}
          options={[UNASSIGNED, ...distinctOptions(assets.filter((a) => a.assigned_employee_id).map((a) => a.assigned_person_name))]}
          onChange={set('assignee')}
        />
        <FilterSelect label="Warranty" value={filters.warranty} options={['In warranty', 'Expiring ≤ 30 days', 'Expired', 'No date']} onChange={set('warranty')} />
        <FilterSelect label="Processor" value={filters.processor} options={distinctOptions(assets.map((a) => a.processor))} onChange={set('processor')} />
        <FilterSelect label="RAM" value={filters.ram} options={distinctOptions(assets.map((a) => a.ram))} onChange={set('ram')} />
        <FilterSelect label="Storage" value={filters.storage} options={distinctOptions(assets.map((a) => a.storage))} onChange={set('storage')} />
        {anyFilter && (
          <button className="btn quiet" onClick={() => setFilters(NO_ASSET_FILTERS)}>
            Clear filters
          </button>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {filtered.length} of {assets.length} shown
        </span>
      </div>

      {summary.length > 0 && (
        <div className="kpis" style={{ marginBottom: 12 }}>
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
          <table>
            <thead>
              <tr>
                <th>Desktop name</th>
                <th>Category</th>
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
                  <td>
                    {a.asset_category ? (
                      <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
                        {a.asset_category}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
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
                  <td className="muted" colSpan={11} style={{ textAlign: 'center' }}>
                    {q || anyFilter ? 'No assets match the current search / filters.' : 'No assets yet.'}
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
