'use client';

// Slide-in drawer for adding OR editing an employee. In create mode it submits to
// createEmployee; when an `employee` is passed it prefills the fields and submits
// to updateEmployee (keyed by the immutable original code). On success it closes.
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createEmployee, updateEmployee } from '@/lib/actions/employees';
import type { EmployeeEditRow } from '@/lib/queries';

type State = { ok?: boolean; error?: string };

export function AddEmployeeDrawer({
  open,
  onClose,
  employee = null,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the drawer edits this employee instead of creating a new one. */
  employee?: EmployeeEditRow | null;
}) {
  const router = useRouter();
  const editing = employee !== null;

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (editing ? updateEmployee(formData) : createEmployee(formData)),
    {},
  );

  // Close + refresh once the action succeeds.
  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
  }, [state.ok, onClose, router]);

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label={editing ? 'Edit employee' : 'Add employee'}>
        {/* key remounts the form when switching between add and a specific
            employee, so the prefilled defaults refresh instead of sticking. */}
        <form key={employee?.code ?? 'new'} action={formAction} style={{ display: 'contents' }}>
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
                defaultValue={employee?.code ?? 'DN046'}
                mono
                readOnly={editing}
              />
            </div>
            <div className="f-row">
              <SelectField
                name="branch"
                label="Branch"
                defaultValue={employee?.branch}
                options={[
                  { value: 'Pune', label: 'Pune (Maharashtra)' },
                  { value: 'Vadodara', label: 'Vadodara (Gujarat)' },
                ]}
              />
              <SelectField
                name="gender"
                label="Gender"
                defaultValue={employee?.gender}
                options={[
                  { value: 'Male', label: 'Male' },
                  { value: 'Female', label: 'Female' },
                ]}
              />
            </div>
            <div className="f-row">
              <Field name="date_of_joining" label="Date of joining" type="date" defaultValue={employee?.date_of_joining ?? '2026-08-01'} />
              <Field name="date_of_birth" label="Date of birth" type="date" defaultValue={employee?.date_of_birth ?? undefined} />
            </div>
            <Field name="whatsapp" label="WhatsApp number" placeholder="+91" mono defaultValue={employee?.whatsapp ?? undefined} />

            <div className="fold">Statutory</div>
            <div className="f-row">
              <Field name="pan" label="PAN" placeholder="ABCDE1234F" mono defaultValue={employee?.pan ?? undefined} />
              <Field name="pf_uan" label="PF UAN" mono defaultValue={employee?.pf_uan ?? undefined} />
            </div>
            <Field name="esic_number" label="ESIC number" mono defaultValue={employee?.esic_number ?? undefined} />

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
            {state.error && <div className="login-error">{state.error}</div>}
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
