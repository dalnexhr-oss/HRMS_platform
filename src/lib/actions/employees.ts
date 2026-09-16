'use server';

// Staff-only employee actions used by the add/edit drawer.
import { revalidatePath } from 'next/cache';
import type { Decimal128 } from 'mongodb';
import { createClient, createServiceClient, isServiceRoleConfigured } from '@/lib/db/server';
import { requireStaff, wroteNothing } from '@/lib/actions/guards';
import { usersCollection } from '@/lib/db/collections';
import { fromPaise as formatMoney } from '@/lib/db/money';
import { calculateSalary } from '@/lib/salary';
import { getEmployeeForEdit, type EmployeeEditRow } from '@/lib/queries';
import { States } from '@/lib/constants';

import { sendEmail, isEmailConfigured } from '@/lib/email';
import { buildWelcomeEmail } from '@/lib/documents/templates';
import { startOnboarding } from '@/lib/actions/onboarding';

// Transient failures worth a second try; a missing account is not one.
const loginUpdateAttempts = 3;

// Enable or disable every login linked to the employee. Preserve links for reactivation and report
// failures to update existing accounts.
async function setEmployeeLoginAccess(
  employeeId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isServiceRoleConfigured()) {
    return { ok: true };
  }

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

    const users = await usersCollection();

    for (const p of profiles) {
      let lastError = 'Could not update login access.';

      for (let attempt = 1; attempt <= loginUpdateAttempts; attempt++) {
        try {
          // Disabling bumps token_version to revoke existing cookies. Re-enabling preserves the
          // current version; getSession rechecks disabled on every request.
          const result = await users.updateOne(
            { _id: p.id as string },
            enabled
              ? { $set: { disabled: false, updated_at: new Date() } }
              : { $set: { disabled: true, updated_at: new Date() }, $inc: { token_version: 1 } },
          );

          if (result.matchedCount > 0) {
            lastError = '';
            break;
          }

          // A missing account is not retryable; reserve retries for transient database failures.
          lastError = 'That login account no longer exists.';
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Could not update login access.';
        }

        // Don't delay after the final attempt.
        if (attempt < loginUpdateAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }

      if (lastError) {
        return { ok: false, error: lastError };
      }
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not update login access.',
    };
  }
}

/**
 * Normalise an Aadhaar number: strip spaces/hyphens, require exactly 12 digits.
 * Empty is allowed (returns null). Mirrors the DB check constraint.
 */
function parseAadhaar(
  v: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = String(v ?? '')
    .replace(/[\s-]/g, '')
    .trim();
  if (!raw) {
    return { ok: true, value: null };
  }
  if (!/^\d{12}$/.test(raw)) {
    return { ok: false, error: 'Aadhaar number must be exactly 12 digits.' };
  }
  return { ok: true, value: raw };
}

/**
 * Normalise an IFSC code: strip spaces, upper-case, require the standard
 * 11-char shape (4 letters + '0' + 6 alphanumerics). Empty is allowed (null).
 * Mirrors the DB check constraint.
 */
function parseIfsc(
  v: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = String(v ?? '')
    .replace(/\s/g, '')
    .toUpperCase()
    .trim();
  if (!raw) {
    return { ok: true, value: null };
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw)) {
    return {
      ok: false,
      error:
        'IFSC must be 11 characters: 4 letters, a 0, then 6 letters/digits (e.g. HDFC0001234).',
    };
  }
  return { ok: true, value: raw };
}

/**
 * Normalize PAN by removing spaces and uppercasing. Accept blank as null; otherwise require five
 * letters, four digits, and one letter, matching the collection validator.
 */
function parsePan(
  v: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = String(v ?? '')
    .replace(/\s/g, '')
    .toUpperCase()
    .trim();
  if (!raw) {
    return { ok: true, value: null };
  }
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(raw)) {
    return {
      ok: false,
      error: 'PAN must be 10 characters: 5 letters, 4 digits, then a letter (e.g. ABCDE1234F).',
    };
  }
  return { ok: true, value: raw };
}

/** Bank account number: strip spaces and hyphens; empty -> null. */
function parseAccountNumber(v: FormDataEntryValue | null): string | null {
  const raw = String(v ?? '')
    .replace(/[\s-]/g, '')
    .trim();
  return raw || null;
}

/** A plain optional text field: trimmed, or null when blank. */
function optionalText(v: FormDataEntryValue | null): string | null {
  return String(v ?? '').trim() || null;
}

/**
 * Bank details + emergency contact columns, shared by create
 * and update so both stay in lockstep. Validates IFSC; the rest are free text.
 */
function parseBankAndEmergency(formData: FormData):
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
  if (!ifsc.ok) {
    return ifsc;
  }
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

/**
 * Calculate salary components in integer paise and return Decimal128 values. The employee validator
 * requires decimal fields and checks that components sum exactly to gross.
 */
function parseSalary(
  formData: FormData,
):
  | { ok: true; gross: Decimal128; basic: Decimal128; hra: Decimal128; special: Decimal128 }
  | { ok: false; error: string } {
  const salary = calculateSalary({
    gross_monthly: String(formData.get('gross_monthly') ?? ''),
    basic_da: String(formData.get('basic_da') ?? ''),
    hra: String(formData.get('hra') ?? ''),
  });
  if (!salary.ok) {
    return { ok: false, error: salary.error };
  }
  return {
    ok: true,
    gross: formatMoney(salary.gross),
    basic: formatMoney(salary.basic),
    hra: formatMoney(salary.hra),
    special: formatMoney(salary.special),
  };
}

/**
 * The edit form includes identity, bank, and salary details. Require write-level access even
 * though this operation only reads.
 */
export async function fetchEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  const gate = await requireStaff('Loading an employee for editing');
  if (!gate.ok) {
    return null;
  }
  return getEmployeeForEdit(code);
}

type DbClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Resolve a department within a branch, creating it if necessary. Match names case-insensitively;
 * blank means no department.
 */

/**
 * Sentinel the drawer's branch <select> submits when "+ Add new branch…" is
 * chosen. Kept out of any real branch's namespace by the leading underscores.
 */
const newBranch = '__new__';

/**
 * Resolve the selected branch to its ID and canonical stored name. Inline creation requires an
 * explicit choice and state; cache the resolved name on the employee.
 */
async function resolveBranch(
  dbc: DbClient,
  formData: FormData,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const selected = String(formData.get('branch') ?? '').trim();

  if (selected !== newBranch) {
    if (!selected) {
      return { ok: false, error: 'Pick a branch.' };
    }
    // Match branch names case-insensitively and use the stored canonical name in the employee
    // record.
    const { data, error } = await dbc
      .from('branches')
      .select('id, name')
      .ilike('name', selected)
      .maybeSingle();
    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: `Unknown branch: ${selected}` };
    }
    return { ok: true, id: data.id, name: data.name };
  }

  const name = String(formData.get('branch_new_name') ?? '').trim();
  const state = String(formData.get('branch_new_state') ?? '').trim();
  if (!name) {
    return { ok: false, error: 'Enter the new branch name.' };
  }
  // States mirrors the branches validator's state enum; the validator
  // still has the final word — a mismatch surfaces as a DB error below.
  if (!(States as readonly string[]).includes(state)) {
    return { ok: false, error: 'Pick the new branch state or union territory.' };
  }

  // Case-insensitive match first so 'pune'/'Pune' can't spawn duplicates
  // (branches.name is unique, but only case-sensitively).
  const { data: found, error: findError } = await dbc
    .from('branches')
    .select('id, name')
    .ilike('name', name)
    .maybeSingle();
  if (findError) {
    return { ok: false, error: findError.message };
  }
  if (found) {
    return { ok: true, id: found.id, name: found.name };
  }

  const { data: created, error } = await dbc
    .from('branches')
    .insert({ name, state })
    .select('id, name')
    .single();
  if (error) {
    // Concurrent creation race: adopt existing branch if created simultaneously.
    if (error.code === '23505') {
      const { data: raced } = await dbc
        .from('branches')
        .select('id, name')
        .ilike('name', name)
        .maybeSingle();
      if (raced) {
        return { ok: true, id: raced.id, name: raced.name };
      }
    }
    return { ok: false, error: `Could not create the branch: ${error.message}` };
  }
  return { ok: true, id: created!.id, name: created!.name };
}

async function resolveDepartment(
  dbc: DbClient,
  name: string,
  branchId: string,
): Promise<{ id: string; name: string } | null> {
  const dept = name.trim();
  if (!dept) {
    return null;
  }
  const { data: found } = await dbc
    .from('departments')
    .select('id, name')
    .eq('branch_id', branchId)
    .ilike('name', dept)
    .maybeSingle();
  if (found) {
    return { id: found.id, name: found.name };
  }
  const { data: created, error } = await dbc
    .from('departments')
    .insert({ name: dept, branch_id: branchId })
    .select('id, name')
    .single();
  if (error) {
    throw error;
  }
  return { id: created!.id, name: created!.name };
}

/**
 * Provision a new or rehired employee's current-year leave balance. The RPC only creates missing
 * rows and skips later-year joiners. Log failures without undoing the employee save; staff can
 * provision missing balances from /leave.
 */
async function provisionCurrentLeaveYear(
  dbc: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  // Business year in IST, matching the provisioning cron — not the server TZ.
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(
      new Date(),
    ),
  );
  await dbc.rpc('fn_provision_leave_balances', { p_year: year });
}

export async function createEmployee(formData: FormData) {
  const gate = await requireStaff('Adding an employee');
  if (!gate.ok) {
    return gate;
  }

  // required fields (fail before touching the network)
  const code = String(formData.get('code') ?? '').trim();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const dateOfJoining = String(formData.get('date_of_joining') ?? '').trim();
  if (!code) {
    return { ok: false, error: 'Employee code is required.' };
  }
  if (!fullName) {
    return { ok: false, error: 'Full name is required.' };
  }
  if (!dateOfJoining) {
    return { ok: false, error: 'Date of joining is required.' };
  }

  const salary = parseSalary(formData);
  if (!salary.ok) {
    return salary;
  }

  const aadhaar = parseAadhaar(formData.get('aadhaar'));
  if (!aadhaar.ok) {
    return aadhaar;
  }

  const pan = parsePan(formData.get('pan'));
  if (!pan.ok) {
    return pan;
  }

  const extra = parseBankAndEmergency(formData);
  if (!extra.ok) {
    return extra;
  }

  const dbc = await createClient();

  // The branch arrives as a NAME (or the add-new sentinel); resolve to an id,
  // creating the branch when that was explicitly requested.
  const branch = await resolveBranch(dbc, formData);
  if (!branch.ok) {
    return branch;
  }

  let department: { id: string; name: string } | null;
  try {
    department = await resolveDepartment(dbc, String(formData.get('department') ?? ''), branch.id);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Could not save the department.' };
  }

  const { data, error } = await dbc
    .from('employees')
    .insert({
      code,
      full_name: fullName,
      branch_id: branch.id,
      department_id: department?.id ?? null,
      // Write cached branch and department names on every save; roster and attendance queries read
      // them without joins.
      branch_name: branch.name,
      department_name: department?.name ?? null,
      designation: (formData.get('designation') as string) || null,
      // employment_type: employmentType(formData),
      gender: String(formData.get('gender') ?? 'Male') as 'Male' | 'Female' | 'Other',
      date_of_joining: dateOfJoining,
      date_of_birth: (formData.get('date_of_birth') as string) || null,
      whatsapp: (formData.get('whatsapp') as string) || null,
      mobile_official: (formData.get('mobile_official') as string) || null,
      mobile_personal: (formData.get('mobile_personal') as string) || null,
      email_official: (formData.get('email_official') as string) || null,
      email_personal: (formData.get('email_personal') as string) || null,
      aadhaar: aadhaar.value,
      pan: pan.value,
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
    // Unique constraint violation (duplicate employee code or Aadhaar).
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
    return {
      ok: false,
      error: 'The employee was not added — your account may not have permission.',
    };
  }

  // Start onboarding from the newest active template when available. A missing template does not
  // undo the employee; HR can start the checklist later.
  const newEmployeeId = (data![0] as { id: string }).id;
  await startOnboarding(newEmployeeId).catch(() => undefined);

  // Their 15-day paid-leave pool, so approving their first leave deducts from a
  // real balance instead of warning "no balance on record".
  await provisionCurrentLeaveYear(dbc).catch(() => undefined);

  // Send the welcome email after saving. Missing SMTP configuration or delivery failure must not
  // undo the employee record.
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
      // The inline Dalnex logo the HTML references via cid:dalnex-logo.
      attachments: mail.attachments,
    });
  }

  revalidatePath('/employees');
  revalidatePath('/leave');
  return { ok: true };
}

/**
 * Update an existing employee, keyed by its (immutable) code carried in a hidden
 * `original_code` field. Same validation as create.
 */
export async function updateEmployee(formData: FormData) {
  const gate = await requireStaff('Updating an employee');
  if (!gate.ok) {
    return gate;
  }

  const originalCode = String(formData.get('original_code') ?? '').trim();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const dateOfJoining = String(formData.get('date_of_joining') ?? '').trim();
  if (!originalCode) {
    return { ok: false, error: 'Which employee to update is missing.' };
  }
  if (!fullName) {
    return { ok: false, error: 'Full name is required.' };
  }
  if (!dateOfJoining) {
    return { ok: false, error: 'Date of joining is required.' };
  }

  const salary = parseSalary(formData);
  if (!salary.ok) {
    return salary;
  }

  const aadhaar = parseAadhaar(formData.get('aadhaar'));
  if (!aadhaar.ok) {
    return aadhaar;
  }

  const pan = parsePan(formData.get('pan'));
  if (!pan.ok) {
    return pan;
  }

  const extra = parseBankAndEmergency(formData);
  if (!extra.ok) {
    return extra;
  }

  const dbc = await createClient();

  const branch = await resolveBranch(dbc, formData);
  if (!branch.ok) {
    return branch;
  }

  let department: { id: string; name: string } | null;
  try {
    department = await resolveDepartment(dbc, String(formData.get('department') ?? ''), branch.id);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Could not save the department.' };
  }

  const { data, error } = await dbc
    .from('employees')
    .update({
      full_name: fullName,
      branch_id: branch.id,
      department_id: department?.id ?? null,
      // Refresh cached branch and department names along with their IDs.
      branch_name: branch.name,
      department_name: department?.name ?? null,
      designation: (formData.get('designation') as string) || null,
      // employment_type: employmentType(formData),
      gender: String(formData.get('gender') ?? 'Male') as 'Male' | 'Female' | 'Other',
      date_of_joining: dateOfJoining,
      date_of_birth: (formData.get('date_of_birth') as string) || null,
      whatsapp: (formData.get('whatsapp') as string) || null,
      mobile_official: (formData.get('mobile_official') as string) || null,
      mobile_personal: (formData.get('mobile_personal') as string) || null,
      email_official: (formData.get('email_official') as string) || null,
      email_personal: (formData.get('email_personal') as string) || null,
      aadhaar: aadhaar.value,
      pan: pan.value,
      pf_uan: (formData.get('pf_uan') as string) || null,
      esic_number: (formData.get('esic_number') as string) || null,
      ...extra.fields,
      gross_monthly: salary.gross,
      basic_da: salary.basic,
      hra: salary.hra,
      special_allowance: salary.special,
    })
    .eq('code', originalCode)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    // Unique constraint violation (duplicate Aadhaar or employee attribute).
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
      error:
        'The employee was not updated — they may no longer exist, or your role lacks permission.',
    };
  }

  revalidatePath('/employees');
  return { ok: true };
}

/** Deactivate an employee (status -> 'inactive'). Keyed by code. */
export async function deactivateEmployee(code: string) {
  const gate = await requireStaff('Deactivating an employee');
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employees')
    .update({ status: 'inactive' })
    .eq('code', code)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error:
        'The employee was not deactivated — they may no longer exist, or your role lacks permission.',
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
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('employees')
    .update({ status: 'active' })
    .eq('code', code)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error:
        'The employee was not reactivated — they may no longer exist, or your role lacks permission.',
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

  // A rehire was invisible to provisioning while inactive — fill the missing
  // paid-leave row for the current year. Idempotent and best-effort (above).
  await provisionCurrentLeaveYear(dbc).catch(() => undefined);

  revalidatePath('/employees');
  revalidatePath('/leave');
  return { ok: true };
}
