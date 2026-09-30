'use client';

// Add an inventory item or edit the supplied item by ID.
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createItem, updateItem } from '@/lib/actions/items';
import type { ItemRow } from '@/lib/server-queries';

interface State {
  ok?: boolean;
  error?: string;
}

const statusOptions = ['In Stock', 'Low Stock', 'Out of Stock', 'Discontinued'];

function AddItemDrawer({
  open,
  onClose,
  item = null,
}: {
  open: boolean;
  onClose: () => void;
  item?: ItemRow | null;
}) {
  const router = useRouter();
  const editing = item !== null;

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (editing ? updateItem(formData) : createItem(formData)),
    {},
  );

  // React to each successful action result once. Keep onClose identity changes from closing a
  // subsequently reopened drawer.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (state.ok) {
      onCloseRef.current();
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside
        className={`drawer${open ? ' is-active' : ''}`}
        aria-label={editing ? 'Edit material / tool' : 'Add material / tool'}
      >
        <form key={item?.id ?? 'new'} action={formAction} style={{ display: 'contents' }}>
          {editing && <input type="hidden" name="id" value={item!.id} />}
          <div className="drawer-header">
            <h3>{editing ? 'Edit material / tool' : 'Add material / tool'}</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="button quiet" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="drawer-body">
            <div className="form-row">
              <Field
                name="item_name"
                label="Name"
                placeholder="e.g. Wireless mouse"
                defaultValue={item?.item_name}
              />
              <Field
                name="item_code"
                label="Material / Tool ID"
                mono
                placeholder="e.g. ITM-001"
                defaultValue={item?.item_code ?? undefined}
              />
            </div>
            <div className="form-row">
              <Field
                name="category"
                label="Category"
                placeholder="e.g. Peripherals"
                defaultValue={item?.category ?? undefined}
              />
              <Field
                name="brand"
                label="Brand"
                placeholder="e.g. Logitech"
                defaultValue={item?.brand ?? undefined}
              />
            </div>
            <Field
              name="size_spec"
              label="Size / specification"
              placeholder="e.g. M-size / 2.4GHz"
              defaultValue={item?.size_spec ?? undefined}
            />

            <div className="section-heading">Stock</div>
            <div className="form-row">
              <Field
                name="total_quantity"
                label="Total quantity"
                type="number"
                defaultValue={item ? String(item.total_quantity) : '0'}
                mono
              />
              <Field
                name="unit"
                label="Unit"
                placeholder="e.g. pcs"
                defaultValue={item?.unit ?? undefined}
              />
            </div>
            <div className="form-row">
              <SelectField
                name="returnable"
                label="Returnable"
                defaultValue={item ? (item.returnable ? 'yes' : 'no') : 'no'}
                options={[
                  { value: 'no', label: 'No' },
                  { value: 'yes', label: 'Yes' },
                ]}
              />
              <SelectField
                name="status"
                label="Item status"
                defaultValue={item?.status ?? 'In Stock'}
                options={statusOptions.map((s) => ({ value: s, label: s }))}
              />
            </div>
            <Field name="remarks" label="Remarks" defaultValue={item?.remarks ?? undefined} />

            {editing && (
              <div className="hint">
                Assigned {item!.quantity_assigned} · Remaining {item!.quantity_remaining}.
                Quantities are managed through the Assign action, not here.
              </div>
            )}

            {state.error && <div className="error-message">{state.error}</div>}
          </div>
          <div className="drawer-footer">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Save material / tool'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  type,
  mono,
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        name={name}
        className={mono ? 'text-monospace' : undefined}
        placeholder={placeholder}
        defaultValue={defaultValue}
        type={type}
      />
    </div>
  );
}

function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select name={name} defaultValue={defaultValue}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export { AddItemDrawer };
