'use client';

// Load assignment and maintenance history when an asset is opened. The asset row supplies its
// current holder.
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetQrEditor } from './AssetQrEditor';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import { assignAsset, unassignAsset, createAssetMaintenance, fetchAssetAssignments, fetchAssetMaintenance } from '@/lib/actions/assets';
import { todayIST } from '@/lib/format';
import type { AssetRow, EmployeeOption, AssetAssignmentRow, AssetMaintenanceRow } from '@/lib/queries';

interface State {
  ok?: boolean;
  error?: string;
}

function AssignAssetDrawer({
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

  // Today in IST, not on the device clock — the same ceiling the action applies.
  const today = todayIST();
  // Reset controlled dates alongside the keyed maintenance form. Next due cannot precede the
  // maintenance date.
  const [maintDate, setMaintDate] = useState('');
  const [nextDue, setNextDue] = useState('');

  // Moving the logged date past an already-chosen next-due drags it along,
  // rather than leaving an interval that runs backwards on screen.
  const onMaintDateChange = (value: string) => {
    setMaintDate(value);
    if (nextDue && value && nextDue < value) {
      setNextDue(value);
    }
  };

  const [state, formAction, submitting] = useActionState<State, FormData>(
    async (_prev, formData) => assignAsset(formData),
    {},
  );

  async function reload(id: string) {
    latestId.current = id;
    const [h, m] = await Promise.all([fetchAssetAssignments(id), fetchAssetMaintenance(id)]);
    if (latestId.current !== id) {
      // a newer asset opened meanwhile
      return;
    }
    setHistory(h);
    setMaint(m);
  }

  // The drawer stays mounted between assets, so clear its local history and dates when the
  // selection changes.
  useEffect(() => {
    if (asset) {
      setRowError(null);
      reload(asset.id);
    } else {
      latestId.current = null;
      setHistory([]);
      setMaint([]);
    }
    setMaintDate('');
    setNextDue('');
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
      setMaintDate('');
      setNextDue('');
    }
  }, [maintState]); // eslint-disable-line react-hooks/exhaustive-deps

  function onUnassign() {
    if (!asset) {
      return;
    }
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

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' is-active' : ''}`} aria-label="Asset detail">
        {asset && (
          <>
            <div className="drawer-header">
              <h3>{asset.desktop_name}</h3>
              <span style={{ flex: 1 }} />
              <button type="button" className="button quiet" onClick={onClose}>
                ✕
              </button>
            </div>
            <div className="drawer-body">
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
                <EmployeePicker
                  key={asset.id}
                  label="Employee name"
                  name="employee_id"
                  employees={employees}
                  required
                  disabled={submitting}
                />
                <div className="form-field">
                  <label>Remarks</label>
                  <input name="remarks" placeholder="Optional note for the history" />
                </div>
                {state.error && <div className="error-message">{state.error}</div>}
                <div style={{ margin: '4px 0 8px' }}>
                  <button type="submit" className="button primary" disabled={submitting}>
                    {submitting ? 'Assigning…' : asset.assigned_employee_id ? 'Reassign' : 'Assign'}
                  </button>
                </div>
              </form>

              {asset.assigned_employee_id && (
                <>
                  <div className="section-heading">Return</div>
                  {rowError && <div className="error-message">{rowError}</div>}
                  <button
                    type="button"
                    className="button quiet"
                    onClick={onUnassign}
                    disabled={pending}
                  >
                    {pending ? '…' : 'Unassign (mark returned)'}
                  </button>
                </>
              )}

              {/* transfer history */}
              <div className="section-heading">Transfer history</div>
              {history.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>
                  No transfers recorded yet.
                </p>
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
                            <span className="text-monospace text-muted" style={{ fontSize: 11 }}>
                              {h.employee_code ?? ''}
                            </span>
                          </td>
                          <td className="text-monospace">{h.assigned_date}</td>
                          <td>{h.returned ? `Returned ${h.returned_date ?? ''}` : 'Held'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* maintenance */}
              <div className="section-heading">Maintenance</div>
              <form key={maintKey} action={maintAction} style={{ display: 'contents' }}>
                <input type="hidden" name="asset_id" value={asset.id} />
                <div className="form-row">
                  <div className="form-field">
                    <label>Date</label>
                    {/* A maintenance row records work that HAS been done, so it
                        looks backwards: no floor, and a ceiling of today. Blank
                        means today (createAssetMaintenance's default). */}
                    <input
                      name="maint_date"
                      type="date"
                      max={today}
                      value={maintDate}
                      onChange={(e) => onMaintDateChange(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>Type</label>
                    <input name="maint_type" placeholder="service / repair / upgrade" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>Cost (₹)</label>
                    <input name="cost" className="text-monospace" inputMode="decimal" placeholder="0" />
                  </div>
                  <div className="form-field">
                    <label>Next due</label>
                    {/* The other end of the same interval: the next service
                        falls after the one just logged, never before it. */}
                    <input
                      name="next_due"
                      type="date"
                      min={maintDate || today}
                      value={nextDue}
                      onChange={(e) => setNextDue(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-field">
                  <label>Vendor / notes</label>
                  <input name="vendor" placeholder="Vendor" />
                </div>
                <div className="form-field">
                  <input name="notes" placeholder="Notes" />
                </div>
                {maintState.error && <div className="error-message">{maintState.error}</div>}
                <div style={{ margin: '4px 0 8px' }}>
                  <button type="submit" className="button quiet" disabled={maintPending}>
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
                        <th className="text-right">Cost</th>
                        <th>Next due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {maint.map((m) => (
                        <tr key={m.id}>
                          <td className="text-monospace">{m.maint_date}</td>
                          <td>{m.maint_type ?? '—'}</td>
                          <td className="text-right text-monospace">{m.cost != null ? `₹${m.cost}` : '—'}</td>
                          <td className="text-monospace">{m.next_due ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="section-heading">Asset label</div>
              <AssetQrEditor
                key={`${asset.id}:${asset.qr_url ?? ''}`}
                assetId={asset.id}
                name={asset.desktop_name}
                url={asset.qr_url}
              />
            </div>
            <div className="drawer-footer">
              <button type="button" className="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

export { AssignAssetDrawer };
