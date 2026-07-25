'use client';

// Add / edit an inventory item. Create submits to createItem; with an `item`
// passed it prefills and submits to updateItem (keyed by hidden id).
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createItem, updateItem } from '@/lib/actions/items';
import type { ItemRow } from '@/lib/queries';

type State = { ok?: boolean; error?: string };

const STATUS_OPTIONS = ['In Stock', 'Low Stock', 'Out of Stock', 'Discontinued'];

export function AddItemDrawer({
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

  // Close + refresh once per successful submit. Keyed on the `state` object
  // identity (useActionState returns a fresh object each dispatch) so it fires
  // exactly once per submit — not again when the parent re-renders with a new
  // onClose identity (which would snap a reopened drawer shut).
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
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label={editing ? 'Edit item' : 'Add item'}>
        <form key={item?.id ?? 'new'} action={formAction} style={{ display: 'contents' }}>
          {editing && <input type="hidden" name="id" value={item!.id} />}
          <div className="dhd">
            <h3>{editing ? 'Edit item' : 'Add item'}</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn quiet" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="dbd">
            <div className="f-row">
              <Field name="item_name" label="Item name" placeholder="e.g. Wireless mouse" defaultValue={item?.item_name} />
              <Field name="item_code" label="Item ID" mono placeholder="e.g. ITM-001" defaultValue={item?.item_code ?? undefined} />
            </div>
            <div className="f-row">
              <Field name="category" label="Category" placeholder="e.g. Peripherals" defaultValue={item?.category ?? undefined} />
              <Field name="brand" label="Brand" placeholder="e.g. Logitech" defaultValue={item?.brand ?? undefined} />
            </div>
            <Field name="size_spec" label="Size / specification" placeholder="e.g. M-size / 2.4GHz" defaultValue={item?.size_spec ?? undefined} />

            <div className="fold">Stock</div>
            <div className="f-row">
              <Field name="total_quantity" label="Total quantity" type="number" defaultValue={item ? String(item.total_quantity) : '0'} mono />
              <Field name="unit" label="Unit" placeholder="e.g. pcs" defaultValue={item?.unit ?? undefined} />
            </div>
            <div className="f-row">
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
                options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
              />
            </div>
            <Field name="remarks" label="Remarks" defaultValue={item?.remarks ?? undefined} />

            {editing && (
              <div className="hint">
                Assigned {item!.quantity_assigned} · Remaining {item!.quantity_remaining}. Quantities are managed
                through the Assign action, not here.
              </div>
            )}

            {state.error && <div className="login-error">{state.error}</div>}
          </div>
          <div className="dft">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Save item'}
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
    <div className="f">
      <label>{label}</label>
      <input name={name} className={mono ? 'mono' : undefined} placeholder={placeholder} defaultValue={defaultValue} type={type} />
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
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <div className="f">
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
