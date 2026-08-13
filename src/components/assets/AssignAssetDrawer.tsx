'use client';

// Per-asset drawer: assign/reassign/return, plus the transfer history, a
// maintenance log, and a scannable QR label. Opens when `asset` is non-null.
// The current holder is read off the asset row; history/maintenance load on open.
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  assignAsset,
  unassignAsset,
  createAssetMaintenance,
  fetchAssetAssignments,
  fetchAssetMaintenance,
} from '@/lib/actions/assets';
import type {
  AssetRow,
  EmployeeOption,
  AssetAssignmentRow,
  AssetMaintenanceRow,
} from '@/lib/queries';

type State = { ok?: boolean; error?: string };

export function AssignAssetDrawer({
  asset,
  employees,
  onClose,
}: {
  asset: AssetRow | null;
  employees: EmployeeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const open = asset !== null;
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<AssetAssignmentRow[]>([]);
  const [maint, setMaint] = useState<AssetMaintenanceRow[]>([]);
  const [maintKey, setMaintKey] = useState(0);
  const latestId = useRef<string | null>(null);

  const [state, formAction, submitting] = useActionState<State, FormData>(
    async (_prev, formData) => assignAsset(formData),
    {},
  );

  async function reload(id: string) {
    latestId.current = id;
    const [h, m] = await Promise.all([fetchAssetAssignments(id), fetchAssetMaintenance(id)]);
    if (latestId.current !== id) return; // a newer asset opened meanwhile
    setHistory(h);
    setMaint(m);
  }

  // Load history/maintenance whenever the target asset changes.
  useEffect(() => {
    if (asset) {
      setRowError(null);
      reload(asset.id);
    } else {
      setHistory([]);
      setMaint([]);
    }
  }, [asset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh page + local lists once an assign succeeds (keep the drawer open so
  // the new history row is visible).
  useEffect(() => {
    if (state.ok && asset) {
      router.refresh();
      reload(asset.id);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const [maintState, maintAction, maintPending] = useActionState<State, FormData>(
    async (_prev, formData) => createAssetMaintenance(formData),
    {},
  );
  useEffect(() => {
    if (maintState.ok && asset) {
      router.refresh();
      reload(asset.id);
      setMaintKey((k) => k + 1);
    }
  }, [maintState]); // eslint-disable-line react-hooks/exhaustive-deps

  function onUnassign() {
    if (!asset) return;
    setRowError(null);
    startTransition(async () => {
      const res = await unassignAsset(asset.id);
      if (!res.ok) {
        setRowError(res.error ?? 'Could not unassign the asset.');
        return;
      }
      router.refresh();
      reload(asset.id);
    });
  }

  // What the QR encodes: a stable identifier for scan-to-lookup. Prefer the
  // serial, then device id, then the asset's row id.
  const qrValue = asset ? asset.serial_no || asset.device_id || asset.id : '';

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label="Asset detail">
        {asset && (
          <>
            <div className="dhd">
              <h3>{asset.desktop_name}</h3>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn quiet" onClick={onClose}>
                ✕
              </button>
            </div>
            <div className="dbd">
              {asset.assigned_employee_id ? (
                <div className="hint">
                  Currently held by <b>{asset.assigned_person_name ?? '—'}</b>
                  {asset.assigned_employee_code ? ` (${asset.assigned_employee_code})` : ''}
                  {asset.assigned_date ? ` · since ${asset.assigned_date}` : ''}. Assigning to
                  someone else reassigns it.
                </div>
              ) : (
                <div className="hint">This asset is not assigned to anyone.</div>
              )}

              <form action={formAction} style={{ display: 'contents' }}>
                <input type="hidden" name="asset_id" value={asset.id} />
                <div className="f">
                  <label>Employee name</label>
                  <select name="employee_id" defaultValue="">
                    <option value="" disabled>
                      Select an employee…
                    </option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f">
                  <label>Remarks</label>
                  <input name="remarks" placeholder="Optional note for the history" />
                </div>
                {state.error && <div className="login-error">{state.error}</div>}
                <div style={{ margin: '4px 0 8px' }}>
                  <button type="submit" className="btn primary" disabled={submitting}>
                    {submitting ? 'Assigning…' : asset.assigned_employee_id ? 'Reassign' : 'Assign'}
                  </button>
                </div>
              </form>

              {asset.assigned_employee_id && (
                <>
                  <div className="fold">Return</div>
                  {rowError && <div className="login-error">{rowError}</div>}
                  <button type="button" className="btn quiet" onClick={onUnassign} disabled={pending}>
                    {pending ? '…' : 'Unassign (mark returned)'}
                  </button>
                </>
              )}

              {/* --- transfer history --- */}
              <div className="fold">Transfer history</div>
              {history.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No transfers recorded yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Holder</th>
                        <th>From</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td>
                            {h.person_name ?? '—'}{' '}
                            <span className="mono muted" style={{ fontSize: 11 }}>{h.employee_code ?? ''}</span>
                          </td>
                          <td className="mono">{h.assigned_date}</td>
                          <td>{h.returned ? `Returned ${h.returned_date ?? ''}` : 'Held'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* --- maintenance --- */}
              <div className="fold">Maintenance</div>
              <form key={maintKey} action={maintAction} style={{ display: 'contents' }}>
                <input type="hidden" name="asset_id" value={asset.id} />
                <div className="f-row">
                  <div className="f">
                    <label>Date</label>
                    <input name="maint_date" type="date" />
                  </div>
                  <div className="f">
                    <label>Type</label>
                    <input name="maint_type" placeholder="service / repair / upgrade" />
                  </div>
                </div>
                <div className="f-row">
                  <div className="f">
                    <label>Cost (₹)</label>
                    <input name="cost" className="mono" inputMode="decimal" placeholder="0" />
                  </div>
                  <div className="f">
                    <label>Next due</label>
                    <input name="next_due" type="date" />
                  </div>
                </div>
                <div className="f">
                  <label>Vendor / notes</label>
                  <input name="vendor" placeholder="Vendor" />
                </div>
                <div className="f">
                  <input name="notes" placeholder="Notes" />
                </div>
                {maintState.error && <div className="login-error">{maintState.error}</div>}
                <div style={{ margin: '4px 0 8px' }}>
                  <button type="submit" className="btn quiet" disabled={maintPending}>
                    {maintPending ? 'Saving…' : 'Add maintenance record'}
                  </button>
                </div>
              </form>
              {maint.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="right">Cost</th>
                        <th>Next due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {maint.map((m) => (
                        <tr key={m.id}>
                          <td className="mono">{m.maint_date}</td>
                          <td>{m.maint_type ?? '—'}</td>
                          <td className="right mono">{m.cost != null ? `₹${m.cost}` : '—'}</td>
                          <td className="mono">{m.next_due ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* --- QR label --- */}
              <div className="fold">Asset label</div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--line-2)' }}>
                  <QRCodeSVG value={qrValue} size={96} />
                </div>
                <div style={{ fontSize: 12 }} className="muted">
                  <div><b>{asset.desktop_name}</b></div>
                  {asset.serial_no && <div className="mono">SN {asset.serial_no}</div>}
                  <div>Scan to look up this asset.</div>
                </div>
              </div>
            </div>
            <div className="dft">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
