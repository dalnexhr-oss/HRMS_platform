'use server';

// Server Actions for mutating employees. The Add/Edit-employee drawer submits its
// <form> here. All are staff-only (admin/hr/manager).
import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient, isServiceRoleConfigured } from '@/lib/supabase/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { getEmployeeForEdit, type EmployeeEditRow } from '@/lib/queries';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { buildWelcomeEmail } from '@/lib/documents/templates';
import { startOnboarding } from '@/lib/actions/onboarding';

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

function isMissingMigration(error: { code?: string }): boolean {
  return error.code === '42703';
}

function migrationError() {
  return {
    ok: false as const,
    error:
      'The employee record could not be saved because a required system update is missing. Please contact your administrator.',
  };
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

/**
 * Normalise an IFSC code: strip spaces, upper-case, require the standard
 * 11-char shape (4 letters + '0' + 6 alphanumerics). Empty is allowed (null).
 * Mirrors the DB check constraint (migration 0023).
 */
function parseIfsc(
  v: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = String(v ?? '').replace(/\s/g, '').toUpperCase().trim();
  if (!raw) return { ok: true, value: null };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw)) {
    return { ok: false, error: 'IFSC must be 11 characters: 4 letters, a 0, then 6 letters/digits (e.g. HDFC0001234).' };
  }
  return { ok: true, value: raw };
}

/** Bank account number: strip spaces and hyphens; empty -> null. */
function parseAccountNumber(v: FormDataEntryValue | null): string | null {
  const raw = String(v ?? '').replace(/[\s-]/g, '').trim();
  return raw || null;
}

/** A plain optional text field: trimmed, or null when blank. */
function optionalText(v: FormDataEntryValue | null): string | null {
  return String(v ?? '').trim() || null;
}

/**
 * Bank details + emergency contact columns (migration 0023), shared by create
 * and update so both stay in lockstep. Validates IFSC; the rest are free text.
 */
function parseBankAndEmergency(
  formData: FormData,
):
  | {
      ok: true;
      fields: {
        bank_name: string | null;
        bank_account_number: string | null;
        bank_ifsc: string | null;
        emergency_contact_name: string | null;
        emergency_contact_relation: string | null;
        emergency_contact_phone: string | null;
      };
    }
  | { ok: false; error: string } {
  const ifsc = parseIfsc(formData.get('bank_ifsc'));
  if (!ifsc.ok) return ifsc;
  return {
    ok: true,
    fields: {
      bank_name: optionalText(formData.get('bank_name')),
      bank_account_number: parseAccountNumber(formData.get('bank_account_number')),
      bank_ifsc: ifsc.value,
      emergency_contact_name: optionalText(formData.get('emergency_contact_name')),
      emergency_contact_relation: optionalText(formData.get('emergency_contact_relation')),
      emergency_contact_phone: optionalText(formData.get('emergency_contact_phone')),
    },
  };
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
 * RLS (portal roles read all employees) is the boundary — so it isn't
 * staff-gated; the WRITE (updateEmployee) is.
 */
export async function fetchEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  return getEmployeeForEdit(code);
}

type DbClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Resolve a department NAME (from the combobox) to its id within the given branch,
 * creating the department if it doesn't exist yet. Empty name → null (optional field).
 * Matches case-insensitively first so 'sales'/'Sales' don't spawn duplicates.
 */
/**
 * Sentinel the drawer's branch <select> submits when "+ Add new branch…" is
 * chosen. Kept out of any real branch's namespace by the leading underscores.
 */
const NEW_BRANCH = '__new__';

/**
 * The only states a branch may live in — mirrors the indian_state enum (0001).
 * This is NOT an arbitrary list: professional tax is computed from pt_slabs per
 * state, so admitting a state with no slabs would silently produce wrong
 * payroll. Extending it means a migration (enum value + pt_slabs rows) first.
 */
const BRANCH_STATES = ['Maharashtra', 'Gujarat'] as const;

/**
 * Resolve the drawer's branch selection to a branch id, creating the branch
 * when "+ Add new branch…" was chosen — the same pick-or-create shape as
 * resolveDepartmentId, except creation is an explicit option rather than
 * free text, because a branch also needs a state and mistyping a name must
 * not silently spawn a new branch.
 */
async function resolveBranch(
  supabase: DbClient,
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const selected = String(formData.get('branch') ?? '').trim();

  if (selected !== NEW_BRANCH) {
    if (!selected) return { ok: false, error: 'Pick a branch.' };
    const { data, error } = await supabase
      .from('branches')
      .select('id')
      .eq('name', selected)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: `Unknown branch: ${selected}` };
    return { ok: true, id: data.id };
  }

  const name = String(formData.get('branch_new_name') ?? '').trim();
  const state = String(formData.get('branch_new_state') ?? '').trim();
  if (!name) return { ok: false, error: 'Enter the new branch name.' };
  if (!(BRANCH_STATES as readonly string[]).includes(state)) {
    return { ok: false, error: 'Pick the new branch state (Maharashtra or Gujarat).' };
  }

  // Case-insensitive match first so 'pune'/'Pune' can't spawn duplicates
  // (branches.name is unique, but only case-sensitively).
  const { data: found, error: findError } = await supabase
    .from('branches')
    .select('id')
    .ilike('name', name)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };
  if (found) return { ok: true, id: found.id };

  const { data: created, error } = await supabase
    .from('branches')
    .insert({ name, state })
    .select('id')
    .single();
  if (error) {
    // Unique race: someone created it between our lookup and insert — use theirs.
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('branches')
        .select('id')
        .ilike('name', name)
        .maybeSingle();
      if (raced) return { ok: true, id: raced.id };
    }
    return { ok: false, error: `Could not create the branch: ${error.message}` };
  }
  return { ok: true, id: created!.id };
}

async function resolveDepartmentId(
  supabase: DbClient,
  name: string,
  branchId: string,
): Promise<string | null> {
  const dept = name.trim();
  if (!dept) return null;
  const { data: found } = await supabase
    .from('departments')
    .select('id')
    .eq('branch_id', branchId)
    .ilike('name', dept)
    .maybeSingle();
  if (found) return found.id;
  const { data: created, error } = await supabase
    .from('departments')
    .insert({ name: dept, branch_id: branchId })
    .select('id')
    .single();
  if (error) throw error;
  return created!.id;
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

  const extra = parseBankAndEmergency(formData);
  if (!extra.ok) return extra;

  const supabase = await createClient();

  // The branch arrives as a NAME (or the add-new sentinel); resolve to an id,
  // creating the branch when that was explicitly requested.
  const branch = await resolveBranch(supabase, formData);
  if (!branch.ok) return branch;

  let departmentId: string | null;
  try {
    departmentId = await resolveDepartmentId(supabase, String(formData.get('department') ?? ''), branch.id);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Could not save the department.' };
  }

  const { data, error } = await supabase
    .from('employees')
    .insert({
      code,
      full_name: fullName,
      branch_id: branch.id,
      department_id: departmentId,
      designation: (formData.get('designation') as string) || null,
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
      ...extra.fields,
      gross_monthly: salary.gross,
      basic_da: salary.basic,
      hra: salary.hra,
      special_allowance: salary.special,
    })
    .select('id');

  if (error) {
    if (isMissingMigration(error)) {
      return migrationError();
    }
    if (error.code === '23505') {
      const dup = /aadhaar/i.test(error.message)
        ? 'That Aadhaar number is already registered to another employee.'
        : `Employee code “${code}” is already in use. Pick a different code.`;
      return { ok: false, error: dup };
    }
    return {
      ok: false,
      error: error.message,
    };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The employee was not added — your account may not have permission.' };
  }

  // Kick off the onboarding checklist from the newest active template. BEST-EFFORT:
  // a template that does not exist yet (or migration 0037 unapplied) must not fail
  // a saved employee — HR can start it by hand from /onboarding.
  const newEmployeeId = (data![0] as { id: string }).id;
  await startOnboarding(newEmployeeId).catch(() => undefined);

  // Welcome email — BEST-EFFORT and last: it is sent through our own SMTP
  // (src/lib/email.ts) and a mail failure must never undo a saved employee. When
  // SMTP is unconfigured this no-ops with a console warning, exactly like
  // notifications without a service key.
  const welcomeTo =
    (formData.get('email_official') as string) || (formData.get('email_personal') as string) || '';
  if (welcomeTo.trim() && isEmailConfigured()) {
    const mail = buildWelcomeEmail({
      employeeName: fullName,
      employeeCode: code,
      startDate: dateOfJoining,
      portalUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.dalnex.com',
    });
    await sendEmail({
      to: welcomeTo.trim(),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
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

  const extra = parseBankAndEmergency(formData);
  if (!extra.ok) return extra;

  const supabase = await createClient();

  const branch = await resolveBranch(supabase, formData);
  if (!branch.ok) return branch;

  let departmentId: string | null;
  try {
    departmentId = await resolveDepartmentId(supabase, String(formData.get('department') ?? ''), branch.id);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Could not save the department.' };
  }

  const { data, error } = await supabase
    .from('employees')
    .update({
      full_name: fullName,
      branch_id: branch.id,
      department_id: departmentId,
      designation: (formData.get('designation') as string) || null,
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
      ...extra.fields,
      gross_monthly: salary.gross,
      basic_da: salary.basic,
      hra: salary.hra,
      special_allowance: salary.special,
    })
    .eq('code', originalCode)
    .select('id');

  if (error) {
    if (isMissingMigration(error)) {
      return migrationError();
    }
    if (error.code === '23505') {
      const dup = /aadhaar/i.test(error.message)
        ? 'That Aadhaar number is already registered to another employee.'
        : 'That value is already in use by another employee.';
      return { ok: false, error: dup };
    }
    return {
      ok: false,
      error: error.message,
    };
  }
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
