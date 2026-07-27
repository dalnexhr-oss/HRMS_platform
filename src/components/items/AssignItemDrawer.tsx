'use client';

// Assign an item to an employee, and view/return its existing assignments.
// Opens when `item` is non-null. The assignment log loads on open and after any
// change; Remaining is recomputed from the active (not-returned) assignments.
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignItem, returnAssignment, deleteAssignment, fetchItemAssignments } from '@/lib/actions/items';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import type { ItemRow, EmployeeOption, ItemAssignmentRow } from '@/lib/queries';

type State = { ok?: boolean; error?: string };

export function AssignItemDrawer({
  item,
  employees,
  onClose,
}: {
  item: ItemRow | null;
  employees: EmployeeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const open = item !== null;

  const [log, setLog] = useState<ItemAssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();
  const latestId = useRef<string | null>(null);

  async function reload(itemId: string) {
    latestId.current = itemId;
    setLoading(true);
    const rows = await fetchItemAssignments(itemId);
    // Drop the result if a newer load (different item) started meanwhile.
    if (latestId.current !== itemId) return;
    setLog(rows);
    setLoading(false);
  }

  // Load (or clear) the log whenever the target item changes.
  useEffect(() => {
    if (item) {
      setRowError(null);
      reload(item.id);
    } else {
      setLog([]);
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [state, formAction, submitting] = useActionState<State, FormData>(
    async (_prev, formData) => assignItem(formData),
    {},
  );

  // After a successful assign: refresh page data, reload the log, reset the form.
  // Keyed on the `state` object identity (fresh per dispatch) so it runs once per
  // assign — including a 2nd consecutive assign where state.ok stays true.
  useEffect(() => {
    if (state.ok && item) {
      toast('Item assigned.', 'success');
      router.refresh();
      reload(item.id);
      setFormKey((k) => k + 1);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeAssigned = log.filter((a) => !a.returned).reduce((s, a) => s + a.quantity, 0);
  const remaining = item ? item.total_quantity - activeAssigned : 0;

  function onReturn(a: ItemAssignmentRow) {
    if (!item) return;
    setRowError(null);
    setBusyId(a.id);
    startTransition(async () => {
      const res = await returnAssignment(a.id);
      setBusyId(null);
      if (!res.ok) {
        setRowError(res.error ?? 'Could not mark as returned.');
        toast(res.error ?? 'Could not mark as returned.', 'error');
        return;
      }
      toast('Marked as returned.', 'success');
      router.refresh();
      reload(item.id);
    });
  }

  async function onDeleteAssignment(a: ItemAssignmentRow) {
    if (!item) return;
    const ok = await confirm({
      title: 'Delete assignment',
      message: `Remove this record${a.person_name ? ` for ${a.person_name}` : ''} (${a.quantity})? If it wasn't returned, the stock is freed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setRowError(null);
    setBusyId(a.id);
    startTransition(async () => {
      const res = await deleteAssignment(a.id);
      setBusyId(null);
      if (!res.ok) {
        setRowError(res.error ?? 'Could not delete the assignment.');
        toast(res.error ?? 'Could not delete the assignment.', 'error');
        return;
      }
      toast('Assignment deleted.', 'success');
      router.refresh();
      reload(item.id);
    });
  }

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label="Assign item">
        {item && (
          <>
            <div className="dhd">
              <h3>Assign · {item.item_name}</h3>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn quiet" onClick={onClose}>
                ✕
              </button>
            </div>
            <div className="dbd">
              <div className="hint">
                Total {item.total_quantity} · Assigned {activeAssigned} · <b>Remaining {remaining}</b>
                {item.unit ? ` ${item.unit}` : ''}
              </div>

              <form key={formKey} action={formAction} style={{ display: 'contents' }}>
                <input type="hidden" name="item_id" value={item.id} />
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
                <div className="f-row">
                  <div className="f">
                    <label>Quantity</label>
                    <input name="quantity" type="number" min={1} max={remaining} defaultValue={1} className="mono" />
                  </div>
                  <div className="f">
                    <label>Assigned date</label>
                    <input name="assigned_date" type="date" placeholder="defaults to today" />
                  </div>
                </div>
                <div className="f">
                  <label>Remarks</label>
                  <input name="remarks" />
                </div>
                {state.error && <div className="login-error">{state.error}</div>}
                <div style={{ margin: '4px 0 8px' }}>
                  <button type="submit" className="btn primary" disabled={submitting || remaining <= 0}>
                    {submitting ? 'Assigning…' : 'Assign'}
                  </button>
                </div>
              </form>

              <div className="fold">Assignment history</div>
              {rowError && <div className="login-error">{rowError}</div>}
              {loading ? (
                <p className="muted">Loading…</p>
              ) : log.length === 0 ? (
                <p className="muted">No assignments yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Emp ID</th>
                        <th className="right">Qty</th>
                        <th>Date</th>
                        <th>By</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.map((a) => (
                        <tr key={a.id}>
                          <td>{a.person_name ?? '—'}</td>
                          <td className="mono muted">{a.employee_code ?? '—'}</td>
                          <td className="right mono">{a.quantity}</td>
                          <td className="mono">{a.assigned_date}</td>
                          <td>{a.assigned_by ?? '—'}</td>
                          <td>{a.returned ? `Returned ${a.returned_date ?? ''}` : 'Held'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {!a.returned && item.returnable && (
                                <button
                                  className="btn quiet"
                                  onClick={() => onReturn(a)}
                                  disabled={pending && busyId === a.id}
                                >
                                  {pending && busyId === a.id ? '…' : 'Return'}
                                </button>
                              )}
                              <button
                                className="btn quiet"
                                onClick={() => onDeleteAssignment(a)}
                                disabled={pending && busyId === a.id}
                                title="Delete this assignment record"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
      {confirmDialog}
      {toastNode}
    </>
  );
}
