'use client';

// Assign an asset to an employee (single holder), or clear the current holder.
// Opens when `asset` is non-null. The current holder is read straight off the
// asset row (getAssets carries the assignment snapshot columns).
import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignAsset, unassignAsset } from '@/lib/actions/assets';
import type { AssetRow, EmployeeOption } from '@/lib/queries';

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

  const [state, formAction, submitting] = useActionState<State, FormData>(
    async (_prev, formData) => assignAsset(formData),
    {},
  );

  // Close + refresh once an assign succeeds.
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

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
      onClose();
    });
  }

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label="Assign asset">
        {asset && (
          <>
            <div className="dhd">
              <h3>Assign · {asset.desktop_name}</h3>
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
                  <label>Assign to</label>
                  <select name="employee_id" defaultValue="">
                    <option value="" disabled>
                      Select an employee…
                    </option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} — {e.name}
                      </option>
                    ))}
                  </select>
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
