'use server';

// Server Actions for mutating employees. The Add/Edit-employee drawer submits its
// <form> here. All are staff-only (admin/hr/manager).
import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient, isServiceRoleConfigured } from '@/lib/supabase/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { getEmployeeForEdit, type EmployeeEditRow } from '@/lib/queries';

// Ban duration handed to Supabase's admin API to block sign-in. ~100 years is
// "indefinite" in practice; 'none' lifts the ban. Existing access tokens are
// re-validated against the auth server on every request (getSession →
// supabase.auth.getUser), so a ban blocks the very next request rather than
// waiting for the current token to expire.
const BAN_INDEFINITE = '876000h';
const BAN_NONE = 'none';

/**
 * Enable or disable sign-in for every login account linked to an employee.
 *
 * Logins are `profiles` rows (profiles.id === auth.users.id) with
 * employee_id === the given employee. Banning/unbanning the auth user is
 * reversible, so it mirrors deactivate/reactivate exactly and leaves the
 * profile → employee link intact for when they come back.
 *
 * Managing auth users needs the service-role key. When it isn't configured no
 * employee login could have been created in the first place (the Users screen
 * requires it), so there is nothing to revoke — this returns ok and does
 * nothing. A real failure to reach or update an existing account IS reported,
 * so the caller never claims to have removed access it couldn't remove.
 */
async function setEmployeeLoginAccess(
  employeeId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isServiceRoleConfigured()) return { ok: true };

  try {
    const admin = createServiceClient();

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id')
      .eq('employee_id', employeeId);

    if (error) {
      return {
        ok: false,
        error: `Could not find the linked login: ${error.message}`,
      };
    }

    // No linked login = nothing to enable/disable.
    if (!profiles?.length) {
      return { ok: true };
    }

    const banDuration = enabled ? BAN_NONE : BAN_INDEFINITE;

    for (const p of profiles) {
      let lastError = 'Could not update login access.';

      // Retry transient Supabase Auth failures.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { error: banErr } =
            await admin.auth.admin.updateUserById(
              p.id as string,
              {
                ban_duration: banDuration,
              },
            );

          // Success.
          if (!banErr) {
            lastError = '';
            break;
          }

          lastError = banErr.message;
        } catch (e) {
          lastError =
            e instanceof Error
              ? e.message
              : 'Could not update login access.';
        }

        // Don't delay after the final attempt.
        if (attempt < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, attempt * 1000),
          );
        }
      }

      // All retries failed.
      if (lastError) {
        return {
          ok: false,
          error: lastError,
        };
      }
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : 'Could not update login access.',
    };
  }
}

/** Parse '30,000' / '₹30,000' -> 30000. */
function money(v: FormDataEntryValue | null): number {
  return Number(String(v ?? '0').replace(/[^0-9.-]/g, '')) || 0;
}

/**
 * Normalise an Aadhaar number: strip spaces/hyphens, require exactly 12 digits.
 * Empty is allowed (returns null). Mirrors the DB check constraint (migration 0019).
 */
function parseAadhaar(
  v: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = String(v ?? '').replace(/[\s-]/g, '').trim();
  if (!raw) return { ok: true, value: null };
  if (!/^\d{12}$/.test(raw)) return { ok: false, error: 'Aadhaar number must be exactly 12 digits.' };
  return { ok: true, value: raw };
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

  const aadhaar = parseAadhaar(formData.get('aadhaar'));
  if (!aadhaar.ok) return aadhaar;

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
      mobile_official: (formData.get('mobile_official') as string) || null,
      mobile_personal: (formData.get('mobile_personal') as string) || null,
      email_official: (formData.get('email_official') as string) || null,
      email_personal: (formData.get('email_personal') as string) || null,
      aadhaar: aadhaar.value,
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

  const aadhaar = parseAadhaar(formData.get('aadhaar'));
  if (!aadhaar.ok) return aadhaar;

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
      mobile_official: (formData.get('mobile_official') as string) || null,
      mobile_personal: (formData.get('mobile_personal') as string) || null,
      email_official: (formData.get('email_official') as string) || null,
      email_personal: (formData.get('email_personal') as string) || null,
      aadhaar: aadhaar.value,
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

  // Revoke sign-in for any linked login. The employee is already inactive at
  // this point; if the ban fails, say so plainly so an admin can finish the job
  // from /users rather than believing access was cut when it wasn't.
  const login = await setEmployeeLoginAccess(data[0].id as string, false);
  if (!login.ok) {
    revalidatePath('/employees');
    return {
      ok: false,
      error: `${code} was deactivated, but their login could not be disabled (${login.error}). Remove their access from the Users screen.`,
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

  // Lift the sign-in ban that deactivation applied, so their login works again.
  const login = await setEmployeeLoginAccess(data[0].id as string, true);
  if (!login.ok) {
    revalidatePath('/employees');
    return {
      ok: false,
      error: `${code} was reactivated, but their login could not be re-enabled (${login.error}). Restore their access from the Users screen.`,
    };
  }

  revalidatePath('/employees');
  return { ok: true };
}
