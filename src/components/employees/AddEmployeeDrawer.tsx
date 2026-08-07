'use client';

// Slide-in drawer for adding OR editing an employee. In create mode it submits to
// createEmployee; when an `employee` is passed it prefills the fields and submits
// to updateEmployee (keyed by the immutable original code). On success it closes.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEmployee, updateEmployee } from '@/lib/actions/employees';
import type { EmployeeEditRow, BranchRow } from '@/lib/queries';

export function AddEmployeeDrawer({
  open,
  onClose,
  employee = null,
  departments = [],
  branches = [],
  formSeq = 0,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the drawer edits this employee instead of creating a new one. */
  employee?: EmployeeEditRow | null;
  /** Existing department names, shown as combobox suggestions (pick or type new). */
  departments?: string[];
  /**
   * Real branches from the DB. Previously this list was hardcoded to Pune and
   * Vadodara, so the form could offer a branch that no longer existed in the
   * table — updateEmployee then failed its name lookup, and the save was lost.
   */
  branches?: BranchRow[];
  /**
   * Bumped by the parent on every open. Part of the form key, so each open
   * remounts from freshly loaded values — and, crucially, CLOSING never changes
   * the key. Re-keying on close remounted the form mid-animation and visibly
   * reset every uncontrolled field (the branch select snapped to its first
   * option, Pune) on a record the user had just saved.
   */
  formSeq?: number;
}) {
  const router = useRouter();
  const editing = employee !== null;

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The branch list is data, not a constant. Falling back to the employee's own
  // branch keeps an edit round-trippable even if the branches query returned
  // nothing, rather than submitting an empty value that can never resolve.
  const branchOptions =
    branches.length > 0
      ? branches.map((b) => ({ value: b.name, label: b.state ? `${b.name} (${b.state})` : b.name }))
      : employee?.branch
        ? [{ value: employee.branch, label: employee.branch }]
        : [];

  // Submitted by hand rather than through <form action={…}> / useActionState.
  // React 19 automatically RESETS an uncontrolled form once its action settles —
  // including when the action fails. That wiped every field back to its
  // defaultValue on a failed save, so a rejected branch change looked exactly
  // like the server had silently reverted it to the stored value. Handling
  // submit ourselves keeps the typed values on screen next to the error.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = editing ? await updateEmployee(formData) : await createEmployee(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not save the employee.');
        return;
      }
      onCloseRef.current();
      router.refresh();
    });
  };

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label={editing ? 'Edit employee' : 'Add employee'}>
        {/* key remounts the form on each open — switching between add and a
            specific employee, and reopening the same employee — so the
            prefilled defaults refresh instead of sticking. */}
        <form
          key={`${employee?.code ?? 'new'}:${formSeq}`}
          onSubmit={onSubmit}
          style={{ display: 'contents' }}
        >
          {editing && <input type="hidden" name="original_code" value={employee!.code} />}
          <div className="dhd">
            <h3>{editing ? `Edit ${employee!.code}` : 'Add employee'}</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn quiet" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="dbd">
            <div className="f-row">
              <Field name="full_name" label="Full name" placeholder="e.g. Rohan Kulkarni" defaultValue={employee?.full_name} />
              <Field
                name="code"
                label="Employee code"
                placeholder="Enter a unique code"
                defaultValue={employee?.code ?? undefined}
                mono
                readOnly={editing}
              />
            </div>
            <BranchPicker
              options={branchOptions}
              branchDefault={employee?.branch}
              genderDefault={employee?.gender}
            />
            <div className="f-row">
              <ComboField
                name="department"
                label="Department"
                placeholder="Pick or type a new one"
                defaultValue={employee?.department ?? undefined}
                options={departments}
              />
              <Field
                name="designation"
                label="Designation"
                placeholder="e.g. Accountant"
                defaultValue={employee?.designation ?? undefined}
              />
            </div>
            <div className="f-row">
              <Field name="date_of_joining" label="Date of joining" type="date" defaultValue={employee?.date_of_joining ?? '2026-08-01'} />
              <Field name="date_of_birth" label="Date of birth" type="date" defaultValue={employee?.date_of_birth ?? undefined} />
            </div>
            <Field name="whatsapp" label="WhatsApp number" placeholder="+91" mono defaultValue={employee?.whatsapp ?? undefined} />

            <div className="fold">Contact</div>
            <div className="f-row">
              <Field name="mobile_official" label="Mobile (official)" placeholder="+91" mono defaultValue={employee?.mobile_official ?? undefined} />
              <Field name="mobile_personal" label="Mobile (personal)" placeholder="+91" mono defaultValue={employee?.mobile_personal ?? undefined} />
            </div>
            <div className="f-row">
              <Field name="email_official" label="Email (official)" type="email" placeholder="name@dalnex.com" mono defaultValue={employee?.email_official ?? undefined} />
              <Field name="email_personal" label="Email (personal)" type="email" placeholder="name@gmail.com" mono defaultValue={employee?.email_personal ?? undefined} />
            </div>

            <div className="fold">Statutory</div>
            <div className="f-row">
              <Field name="pan" label="PAN" placeholder="ABCDE1234F" mono defaultValue={employee?.pan ?? undefined} />
              <Field name="aadhaar" label="Aadhaar number" placeholder="1234 5678 9012" mono defaultValue={employee?.aadhaar ?? undefined} />
            </div>
            <div className="f-row">
              <Field name="pf_uan" label="PF UAN" mono defaultValue={employee?.pf_uan ?? undefined} />
              <Field name="esic_number" label="ESIC number" mono defaultValue={employee?.esic_number ?? undefined} />
            </div>

            <div className="fold">Bank details</div>
            <Field name="bank_name" label="Bank name" placeholder="e.g. HDFC Bank" defaultValue={employee?.bank_name ?? undefined} />
            <div className="f-row">
              <Field name="bank_account_number" label="Account number" placeholder="50100123456789" mono defaultValue={employee?.bank_account_number ?? undefined} />
              <Field name="bank_ifsc" label="IFSC code" placeholder="HDFC0001234" mono defaultValue={employee?.bank_ifsc ?? undefined} />
            </div>

            <div className="fold">Emergency contact</div>
            <div className="f-row">
              <Field name="emergency_contact_name" label="Contact name" placeholder="e.g. Meera Kulkarni" defaultValue={employee?.emergency_contact_name ?? undefined} />
              <Field name="emergency_contact_relation" label="Relationship" placeholder="e.g. Spouse" defaultValue={employee?.emergency_contact_relation ?? undefined} />
            </div>
            <Field name="emergency_contact_phone" label="Emergency phone" placeholder="+91" mono defaultValue={employee?.emergency_contact_phone ?? undefined} />

            <div className="fold">Salary structure</div>
            <div className="f-row">
              <Field name="gross_monthly" label="Gross / month (₹)" defaultValue={fmt(employee?.gross_monthly, '30,000')} mono />
              <Field name="basic_da" label="Basic + DA (₹)" defaultValue={fmt(employee?.basic_da, '15,000')} mono />
            </div>
            <div className="f-row">
              <Field name="hra" label="HRA (₹)" defaultValue={fmt(employee?.hra, '9,000')} mono />
              <Field name="special_allowance" label="Special allowance (₹)" defaultValue={fmt(employee?.special_allowance, '6,000')} mono readOnly />
            </div>
            <div className="hint">
              Special allowance is derived as gross − (Basic + DA) − HRA so the components always sum
              to gross (a database rule). PT applies by branch state.
            </div>
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="dft">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Save employee'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

/** number -> '30,000' string for a form default; falls back to a placeholder default. */
function fmt(n: number | undefined, fallback: string): string {
  return n != null ? n.toLocaleString('en-IN') : fallback;
}

/** Sentinel understood by resolveBranch in the employees actions. */
const NEW_BRANCH = '__new__';

/**
 * Branch + gender row, plus the fields for creating a branch inline when
 * "+ Add new branch…" is picked. Unlike departments (a free-text combobox),
 * creating a branch is an explicit choice: it also needs a STATE, because
 * professional tax slabs are defined per state — and a typo must not be able
 * to silently spawn a branch.
 *
 * Lives INSIDE the keyed <form>, so its selection state resets on every open.
 */
function BranchPicker({
  options,
  branchDefault,
  genderDefault,
}: {
  options: { value: string; label: string }[];
  branchDefault?: string;
  genderDefault?: string;
}) {
  // No branches at all (first run) → jump straight to the add-new fields.
  const [sel, setSel] = useState(branchDefault || options[0]?.value || NEW_BRANCH);
  const adding = sel === NEW_BRANCH;

  return (
    <>
      <div className="f-row">
        <div className="f">
          <label>Branch</label>
          <select name="branch" value={sel} onChange={(e) => setSel(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value={NEW_BRANCH}>+ Add new branch…</option>
          </select>
        </div>
        <SelectField
          name="gender"
          label="Gender"
          defaultValue={genderDefault}
          options={[
            { value: 'Male', label: 'Male' },
            { value: 'Female', label: 'Female' },
            { value: 'Other', label: 'Other' },
          ]}
        />
      </div>
      {adding && (
        <>
          <div className="f-row">
            <Field name="branch_new_name" label="New branch name" placeholder="e.g. Nashik" />
            <SelectField
              name="branch_new_state"
              label="Branch state"
              options={[
                { value: 'Maharashtra', label: 'Maharashtra' },
                { value: 'Gujarat', label: 'Gujarat' },
              ]}
            />
          </div>
          <div className="hint">
            Only Maharashtra and Gujarat are available: professional tax is computed from per-state
            slabs, so a new state needs a migration (enum value + PT slabs) before it can be offered.
          </div>
        </>
      )}
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
  readOnly,
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
  mono?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="f">
      <label>{label}</label>
      <input
        name={name}
        className={mono ? 'mono' : undefined}
        placeholder={placeholder}
        defaultValue={defaultValue}
        type={type}
        readOnly={readOnly}
      />
    </div>
  );
}

/** Text input backed by a <datalist>: pick an existing suggestion or type a new value. */
function ComboField({
  name,
  label,
  options,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  options: string[];
  placeholder?: string;
  defaultValue?: string;
}) {
  const listId = `${name}-list`;
  return (
    <div className="f">
      <label>{label}</label>
      <input name={name} list={listId} placeholder={placeholder} defaultValue={defaultValue} />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
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
