'use client';

// Slide-in drawer for adding OR editing an IT asset. Create mode submits to
// createAsset; when an `asset` is passed it prefills and submits to updateAsset
// (keyed by the hidden id). Mirrors AddEmployeeDrawer.
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAsset, updateAsset } from '@/lib/actions/assets';
import { todayIST } from '@/lib/format';
import type { AssetRow } from '@/lib/queries';

type State = { ok?: boolean; error?: string };

export function AddAssetDrawer({
  open,
  onClose,
  asset = null,
}: {
  open: boolean;
  onClose: () => void;
  // When set, the drawer edits this asset instead of creating a new one.
  asset?: AssetRow | null;
}) {
  const router = useRouter();
  const editing = asset !== null;

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (editing ? updateAsset(formData) : createAsset(formData)),
    {},
  );

  // Close + refresh once per successful submit — keyed on the `state` object
  // identity so a reopened drawer isn't snapped shut by a stale state.ok=true.
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
      <aside className={`drawer${open ? ' on' : ''}`} aria-label={editing ? 'Edit asset' : 'Add asset'}>
        <form key={asset?.id ?? 'new'} action={formAction} style={{ display: 'contents' }}>
          {editing && <input type="hidden" name="id" value={asset!.id} />}
          <div className="dhd">
            <h3>{editing ? 'Edit asset' : 'Add asset'}</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn quiet" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="dbd">
            <Field name="desktop_name" label="Desktop name" placeholder="e.g. DALNEX-PC-07" defaultValue={asset?.desktop_name} />
            <div className="f-row">
              <div className="f">
                <label>Category</label>
                <input
                  name="asset_category"
                  list="asset-category-options"
                  placeholder="e.g. Desktop, Laptop, Monitor"
                  defaultValue={asset?.asset_category ?? undefined}
                />
                <datalist id="asset-category-options">
                  <option value="Desktop" />
                  <option value="Laptop" />
                  <option value="Monitor" />
                  <option value="Printer" />
                  <option value="Peripheral" />
                  <option value="Networking" />
                </datalist>
              </div>
              <Field name="brand" label="Brand" placeholder="e.g. Dell" defaultValue={asset?.brand ?? undefined} />
            </div>
            <Field name="model_no" label="Model no." mono defaultValue={asset?.model_no ?? undefined} />
            <div className="f-row">
              <Field name="serial_no" label="Serial no." mono defaultValue={asset?.serial_no ?? undefined} />
              <Field name="device_id" label="Device ID" mono defaultValue={asset?.device_id ?? undefined} />
            </div>
            <Field name="product_id" label="Product ID" mono defaultValue={asset?.product_id ?? undefined} />

            <PurchaseAndWarranty asset={asset} />

            <div className="fold">Specifications</div>
            <div className="f-row">
              <Field name="processor" label="Processor" placeholder="e.g. Intel i5-1235U" defaultValue={asset?.processor ?? undefined} />
              <Field name="ram" label="RAM" placeholder="e.g. 16 GB" mono defaultValue={asset?.ram ?? undefined} />
            </div>
            <div className="f-row">
              <Field name="graphics_card" label="Graphics card" placeholder="e.g. Intel Iris Xe" defaultValue={asset?.graphics_card ?? undefined} />
              <Field name="storage" label="Storage" placeholder="e.g. 512 GB SSD" mono defaultValue={asset?.storage ?? undefined} />
            </div>
            <Field name="antivirus" label="Antivirus" placeholder="e.g. Quick Heal (valid to …)" defaultValue={asset?.antivirus ?? undefined} />

            {state.error && <div className="login-error">{state.error}</div>}
          </div>
          <div className="dft">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Save asset'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

/**
 * The purchase and warranty dates, which only make sense relative to each other.
 *
 * Purchase is the one date here that looks BACKWARDS: an asset bought five
 * years ago is ordinary, so there is no floor on it — only a ceiling of today,
 * because a machine cannot have been bought tomorrow. Warranty cover and its
 * renewal then run FORWARD from that purchase, so the purchase date is their
 * floor, and the renewal cannot fall before the cover it renews.
 *
 * Lives inside the keyed <form> so its state resets with every open, the same
 * arrangement AddEmployeeDrawer uses for BranchPicker. Held as state rather
 * than left uncontrolled because each bound is read off the field above it.
 */
function PurchaseAndWarranty({ asset }: { asset: AssetRow | null }) {
  const today = todayIST();
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchase_date ?? '');
  const [warrantyUpto, setWarrantyUpto] = useState(asset?.warranty_upto ?? '');

  return (
    <>
      <div className="fold">Purchase</div>
      <div className="f-row">
        <Field
          name="purchase_date"
          label="Purchased on"
          type="date"
          max={today}
          value={purchaseDate}
          onValueChange={setPurchaseDate}
        />
        <Field
          name="purchase_cost"
          label="Purchase cost (₹)"
          type="number"
          step="0.01"
          mono
          placeholder="e.g. 54990"
          defaultValue={asset?.purchase_cost != null ? String(asset.purchase_cost) : undefined}
        />
      </div>

      <div className="fold">Warranty</div>
      <div className="f-row">
        <Field
          name="warranty_upto"
          label="Warranty upto"
          type="date"
          min={purchaseDate || undefined}
          value={warrantyUpto}
          onValueChange={setWarrantyUpto}
        />
        <Field
          name="warranty_renew"
          label="Renew warranty date"
          type="date"
          min={warrantyUpto || purchaseDate || undefined}
          defaultValue={asset?.warranty_renew ?? undefined}
        />
      </div>
    </>
  );
}

/**
 * One labelled input. Uncontrolled by default (`defaultValue`); pass `value`
 * WITH `onValueChange` for the few fields another field's bound is read from.
 */
function Field({
  name,
  label,
  placeholder,
  defaultValue,
  value,
  onValueChange,
  type,
  step,
  min,
  max,
  mono,
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  type?: string;
  /** type="number" defaults to step=1, which rejects paise. */
  step?: string;
  /** Bounds for type="date" — see PurchaseAndWarranty for what they encode. */
  min?: string;
  max?: string;
  mono?: boolean;
}) {
  return (
    <div className="f">
      <label>{label}</label>
      <input
        name={name}
        className={mono ? 'mono' : undefined}
        placeholder={placeholder}
        {...(onValueChange
          ? { value: value ?? '', onChange: (e) => onValueChange(e.target.value) }
          : { defaultValue })}
        type={type}
        step={step}
        min={min}
        max={max}
      />
    </div>
  );
}
