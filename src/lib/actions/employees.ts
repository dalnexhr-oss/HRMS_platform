'use server';

// Server Actions for mutating employees. The Add/Edit-employee drawer submits its
// <form> here. All are staff-only (admin/hr/manager).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { getEmployeeForEdit, type EmployeeEditRow } from '@/lib/queries';

/** Parse '30,000' / '₹30,000' -> 30000. */
function money(v: FormDataEntryValue | null): number {
  return Number(String(v ?? '0').replace(/[^0-9.-]/g, '')) || 0;
}

/** Shared salary parse: derives special to satisfy the DB CHECK (basic+hra+special=gross). */
function parseSalary(
  formData: FormData,
): { ok: true; gross: number; basic: number; hra: number; special: number } | { ok: false; error: string } {
  const gross = money(formData.get('gross_monthly'));
  const basic = money(formData.get('basic_da'));
  const hra = money(formData.get('hra'));
  if (gross <= 0) return { ok: false, error: 'Gross monthly must be greater than zero.' };
  if (basic + hra > gross) {
    return {
      ok: false,
      error: `Basic + DA (₹${basic}) plus HRA (₹${hra}) exceed gross (₹${gross}). Adjust the salary structure.`,
    };
  }
  return { ok: true, gross, basic, hra, special: gross - basic - hra };
}

/**
 * Load one employee's full editable fields for the edit drawer. This is a READ —
 * RLS (portal roles read all employees) is the boundary, and demo mode returns
 * demo data — so it isn't staff-gated; the WRITE (updateEmployee) is.
 */
export async function fetchEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  return getEmployeeForEdit(code);
}

export async function createEmployee(formData: FormData) {
  const gate = await requireStaff('Adding an employee');
  if (!gate.ok) return gate;

  // --- required fields (fail before touching the network) --------------------
  const code = String(formData.get('code') ?? '').trim();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const dateOfJoining = String(formData.get('date_of_joining') ?? '').trim();
  if (!code) return { ok: false, error: 'Employee code is required.' };
  if (!fullName) return { ok: false, error: 'Full name is required.' };
  if (!dateOfJoining) return { ok: false, error: 'Date of joining is required.' };

  const salary = parseSalary(formData);
  if (!salary.ok) return salary;

  const supabase = await createClient();

  // The branch field arrives as a NAME ('Pune' | 'Vadodara'); resolve to id.
  const branchName = String(formData.get('branch') ?? '').trim();
  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .select('id')
    .eq('name', branchName)
    .single();

  if (branchError || !branch) {
    return { ok: false, error: branchError?.message ?? `Unknown branch: ${branchName}` };
  }

  const { data, error } = await supabase
    .from('employees')
    .insert({
      code,
      full_name: fullName,
      branch_id: branch.id,
      gender: String(formData.get('gender') ?? 'Male') as 'Male' | 'Female' | 'Other',
      date_of_joining: dateOfJoining,
      date_of_birth: (formData.get('date_of_birth') as string) || null,
      whatsapp: (formData.get('whatsapp') as string) || null,
      pan: (formData.get('pan') as string) || null,
      pf_uan: (formData.get('pf_uan') as string) || null,
      esic_number: (formData.get('esic_number') as string) || null,
      gross_monthly: salary.gross,
      basic_da: salary.basic,
      hra: salary.hra,
      special_allowance: salary.special,
    })
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The employee was not added — your account may not have permission.' };
  }

  revalidatePath('/employees');
  return { ok: true };
}

/**
 * Update an existing employee, keyed by its (immutable) code carried in a hidden
 * `original_code` field. Same validation as create.
 */
export async function updateEmployee(formData: FormData) {
  const gate = await requireStaff('Updating an employee');
  if (!gate.ok) return gate;

  const originalCode = String(formData.get('original_code') ?? '').trim();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const dateOfJoining = String(formData.get('date_of_joining') ?? '').trim();
  if (!originalCode) return { ok: false, error: 'Which employee to update is missing.' };
  if (!fullName) return { ok: false, error: 'Full name is required.' };
  if (!dateOfJoining) return { ok: false, error: 'Date of joining is required.' };

  const salary = parseSalary(formData);
  if (!salary.ok) return salary;

  const supabase = await createClient();

  const branchName = String(formData.get('branch') ?? '').trim();
  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .select('id')
    .eq('name', branchName)
    .single();
  if (branchError || !branch) {
    return { ok: false, error: branchError?.message ?? `Unknown branch: ${branchName}` };
  }

  const { data, error } = await supabase
    .from('employees')
    .update({
      full_name: fullName,
      branch_id: branch.id,
      gender: String(formData.get('gender') ?? 'Male') as 'Male' | 'Female' | 'Other',
      date_of_joining: dateOfJoining,
      date_of_birth: (formData.get('date_of_birth') as string) || null,
      whatsapp: (formData.get('whatsapp') as string) || null,
      pan: (formData.get('pan') as string) || null,
      pf_uan: (formData.get('pf_uan') as string) || null,
      esic_number: (formData.get('esic_number') as string) || null,
      gross_monthly: salary.gross,
      basic_da: salary.basic,
      hra: salary.hra,
      special_allowance: salary.special,
    })
    .eq('code', originalCode)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The employee was not updated — they may no longer exist, or your role lacks permission.',
    };
  }

  revalidatePath('/employees');
  return { ok: true };
}

/** Deactivate an employee (status -> 'inactive'). Keyed by code. */
export async function deactivateEmployee(code: string) {
  const gate = await requireStaff('Deactivating an employee');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .update({ status: 'inactive' })
    .eq('code', code)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The employee was not deactivated — they may no longer exist, or your role lacks permission.',
    };
  }

  revalidatePath('/employees');
  return { ok: true };
}

/** Bring a deactivated employee back onto the active roster. */
export async function reactivateEmployee(code: string) {
  const gate = await requireStaff('Reactivating an employee');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .update({ status: 'active' })
    .eq('code', code)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The employee was not reactivated — they may no longer exist, or your role lacks permission.',
    };
  }

  revalidatePath('/employees');
  return { ok: true };
}
