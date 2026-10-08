'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePtSlab, savePtSlab } from '@/lib/actions/professional-tax';
import { inr } from '@/lib/display-formatting';
import { States } from '@/lib/indian-states';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import type { PtSlabView } from '@/lib/queries/professional-tax';

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Professional tax slabs by state. Payroll picks the slab whose gross range contains the
// employee's monthly gross; a month-specific slab wins over a general one, then a gender-specific
// one, then the slab that starts at the highest gross.
function ProfessionalTaxScreen({
  slabs,
  branchStates,
}: {
  slabs: PtSlabView[];
  // States that have a branch.
  branchStates: string[];
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();
  const [editing, setEditing] = useState<PtSlabView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const statesWithSlabs = new Set(slabs.map((slab) => slab.state));
  const uncovered = branchStates.filter((state) => !statesWithSlabs.has(state));

  async function remove(slab: PtSlabView) {
    const ok = await confirm({
      title: 'Delete slab',
      message: `Delete the ${slab.state} slab starting at ${inr(slab.minGross)}? Payslips computed after this will no longer charge it.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setBusyId(slab.id);
    startTransition(async () => {
      const res = await deletePtSlab(slab.id);
      setBusyId(null);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not delete the slab.', 'error');
        return;
      }
      if (editing?.id === slab.id) {
        setEditing(null);
      }
      showNotification('Slab deleted.', 'success');
      router.refresh();
    });
  }

  return (
    <div className="content-container grid">
      {confirmDialog}
      {notificationContainer}

      {uncovered.length > 0 && (
        <div className="hint">
          No slab is set for <b>{uncovered.join(', ')}</b>, so employees in{' '}
          {uncovered.length === 1 ? 'that state' : 'those states'} are charged no professional tax.
        </div>
      )}

      <div className="two-column-layout">
        <div className="card">
          <div className="card-header">
            <h3>Professional tax slabs</h3>
            <span className="card-caption">
              {slabs.length} slab{slabs.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="card-body">
            {slabs.length === 0 ? (
              <p className="empty-state">
                No slabs yet, so no professional tax is deducted. Add the first one on the right.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Monthly gross</th>
                      <th>Applies to</th>
                      <th>Month</th>
                      <th className="text-right">Tax</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {slabs.map((slab) => (
                      <tr key={slab.id}>
                        <td>
                          <b>{slab.state}</b>
                        </td>
                        <td className="text-monospace">
                          {slab.maxGross === null
                            ? `${inr(slab.minGross)} and above`
                            : `${inr(slab.minGross)} – ${inr(slab.maxGross)}`}
                        </td>
                        <td>{slab.gender ?? 'Everyone'}</td>
                        <td>{slab.month ? monthNames[slab.month - 1] : 'Every month'}</td>
                        <td className="text-right text-monospace">{inr(slab.amount)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="button quiet"
                              onClick={() => setEditing(slab)}
                              disabled={pending}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button quiet"
                              onClick={() => remove(slab)}
                              disabled={pending}
                            >
                              {pending && busyId === slab.id ? '…' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
              A payslip uses the slab for the branch’s state whose range contains the employee’s
              full monthly gross. Changes apply the next time drafts are recomputed; locked and paid
              runs are not affected.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{editing ? 'Edit slab' : 'Add slab'}</h3>
          </div>
          <div className="card-body">
            {/* The key re-seeds the fields when a different slab is opened, or after a save. */}
            <SlabForm
              key={editing?.id ?? 'new'}
              slab={editing}
              defaultState={branchStates[0]}
              onDone={(message) => {
                setEditing(null);
                showNotification(message, 'success');
                router.refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SlabForm({
  slab,
  defaultState,
  onDone,
  onCancel,
}: {
  slab: PtSlabView | null;
  defaultState?: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await savePtSlab(formData);
      if (res.ok) {
        onDone(slab ? 'Slab updated.' : 'Slab added.');
      }
      return res;
    },
    {},
  );

  return (
    <form action={action}>
      {slab && <input type="hidden" name="id" value={slab.id} />}
      <div className="form-field">
        <label htmlFor="pt-state">State</label>
        <select
          id="pt-state"
          name="state"
          defaultValue={slab?.state ?? defaultState ?? ''}
          required
        >
          <option value="" disabled>
            Choose a state
          </option>
          {States.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="pt-min">Gross from (₹)</label>
          <input
            id="pt-min"
            name="min_gross"
            inputMode="decimal"
            defaultValue={slab ? String(slab.minGross) : '0'}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="pt-max">Gross up to (₹)</label>
          <input
            id="pt-max"
            name="max_gross"
            inputMode="decimal"
            placeholder="No upper limit"
            defaultValue={slab?.maxGross != null ? String(slab.maxGross) : ''}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="pt-gender">Applies to</label>
          <select id="pt-gender" name="gender" defaultValue={slab?.gender ?? ''}>
            <option value="">Everyone</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="pt-month">Month</label>
          <select id="pt-month" name="month" defaultValue={slab?.month ? String(slab.month) : ''}>
            <option value="">Every month</option>
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>
                {name} only
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="pt-amount">Tax per month (₹)</label>
        <input
          id="pt-amount"
          name="amount"
          inputMode="decimal"
          placeholder="e.g. 200"
          defaultValue={slab ? String(slab.amount) : ''}
          required
        />
      </div>

      {state.error && <div className="error-message">{state.error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : slab ? 'Save changes' : 'Add slab'}
        </button>
        {slab && (
          <button className="button" type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export { ProfessionalTaxScreen };
