'use server';

// Server Actions for mutating employees. The Add/Edit-employee drawer submits its
// <form> here. All are staff-only (admin/hr).
import { revalidatePath } from 'next/cache';
import type { Decimal128 } from 'mongodb';
import { createClient, createServiceClient, isServiceRoleConfigured } from '@/lib/db/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { usersCollection } from '@/lib/db/collections';
import { formatMoney, fromPaise, toPaise } from '@/lib/db/money';
import { getEmployeeForEdit, type EmployeeEditRow } from '@/lib/queries';
import { INDIAN_STATES } from '@/lib/constants';

import { sendEmail, isEmailConfigured } from '@/lib/email';
import { buildWelcomeEmail } from '@/lib/documents/templates';
import { startOnboarding } from '@/lib/actions/onboarding';

/** Transient failures worth a second try; a missing account is not one. */
const LOGIN_UPDATE_ATTEMPTS = 3;

/**
 * Enable or disable sign-in for every login account linked to an employee.
 *
 * Reversible by design: it mirrors deactivate/reactivate and leaves the
 * login → employee link intact for when they come back.
 *
 * A real failure to update an existing account IS reported, so the caller never
 * claims to have removed access it could not remove.
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

    const users = await usersCollection();

    for (const p of profiles) {
      let lastError = 'Could not update login access.';

      for (let attempt = 1; attempt <= LOGIN_UPDATE_ATTEMPTS; attempt++) {
        try {
          // Access is users.disabled, which getSession() re-checks on every
          // request.
          //
          // Disabling ALSO bumps token_version, and that half matters more here
          // than the flag does: these sessions last a year, so without the bump
          // a revoked employee would keep a working cookie long after their
          // access was withdrawn. Enabling does not bump — restoring access
          // should not sign the person out of a device they still hold.
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

          // TERMINAL, not transient: the account is gone, and asking again
          // twice more cannot bring it back. The retry loop is here for a
          // dropped connection, and treating "no such row" as retryable just
          // spent three seconds arriving at the same answer.
          lastError = 'That login account no longer exists.';
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Could not update login access.';
        }

        // Don't delay after the final attempt.
        if (attempt < LOGIN_UPDATE_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }

      if (lastError) return { ok: false, error: lastError };
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

/**
 * A money form field as whole paise.
 *
 * Returns null when the text is not a number at all, so the caller can say so
 * instead of silently storing a zero — the old `|| 0` turned a typo in the
 * salary box into a real salary of nothing.
 */
function moneyPaise(v: FormDataEntryValue | null): number | null {
  const cleaned = String(v ?? '').replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  // toPaise() accepts only this shape; anything else throws, and a thrown
  // TypeError inside a Server Action reaches the user as an unhandled 500.
  if (!/^-?\d*(?:\.\d*)?$/.test(cleaned)) return null;
  return toPaise(cleaned);
}

/**
 * Normalise an Aadhaar number: strip spaces/hyphens, require exactly 12 digits.
 * Empty is allowed (returns null). Mirrors the DB check constraint.
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
 * Mirrors the DB check constraint.
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

/**
 * Normalise a PAN: strip spaces, upper-case, require the standard 10-char shape
 * (5 letters + 4 digits + 1 letter). Empty is allowed (null).
 *
 * Mirrors the format check the employees validator
 * enforces as `^[A-Z]{5}[0-9]{4}[A-Z]$`. Without this the raw field went
 * straight to the database, so a lower-case or half-typed PAN — 'abcde1234f',
 * or a stray trailing space — was refused there and surfaced as the unhelpful
 * "new row violates check constraint".
 */
function parsePan(
  v: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = String(v ?? '').replace(/\s/g, '').toUpperCase().trim();
  if (!raw) return { ok: true, value: null };
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(raw)) {
    return { ok: false, error: 'PAN must be 10 characters: 5 letters, 4 digits, then a letter (e.g. ABCDE1234F).' };
  }
  return { ok: true, value: raw };
}

/** Bank account number: strip spaces and hyphens; empty -> null. */
function parseAccountNumber(v: FormDataEntryValue | null): string | null {
  const raw = String(v ?? '').replace(/[\s-]/g, '').trim();
  return raw || null;
}

/**
 * Employment type off the form.
 *
 * Anything that is not the literal 'intern' is an employee. The test is
 * deliberately one-sided: interns are the ones with the different payroll
 * rules, so a renamed option, a stale cached form or a missing field has to
 * fall to 'employee' rather than quietly move somebody onto intern pay.
 */
// function employmentType(formData: FormData): EmploymentType {
//   return String(formData.get('employment_type') ?? '') === 'intern' ? 'intern' : 'employee';
// }

/** A plain optional text field: trimmed, or null when blank. */
function optionalText(v: FormDataEntryValue | null): string | null {
  return String(v ?? '').trim() || null;
}

/**
 * Bank details + emergency contact columns, shared by create
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

/**
 * Shared salary parse: derives special so the components always total gross.
 *
 * Amounts are computed in PAISE and returned as Decimal128, which is what the
 * employees validator requires. It rejects a write on two counts, and a plain
 * JS number fails both: every component is declared `bsonType: "decimal"`, and
 * a `$expr` re-checks gross == basic_da + hra + special_allowance, which float
 * subtraction cannot be trusted to satisfy once paise are involved. MongoDB
 * reports either as error 121, which pgcompat surfaces as "new row violates
 * check constraint".
 */
function parseSalary(
  formData: FormData,
):
  | { ok: true; gross: Decimal128; basic: Decimal128; hra: Decimal128; special: Decimal128 }
  | { ok: false; error: string } {
  const gross = moneyPaise(formData.get('gross_monthly'));
  const basic = moneyPaise(formData.get('basic_da'));
  const hra = moneyPaise(formData.get('hra'));
  if (gross === null || basic === null || hra === null) {
    return { ok: false, error: 'Enter the salary amounts as plain numbers, e.g. 30000 or 30000.50.' };
  }
  if (gross <= 0) return { ok: false, error: 'Gross monthly must be greater than zero.' };
  if (basic + hra > gross) {
    return {
      ok: false,
      error:
        `Basic + DA (${formatMoney(fromPaise(basic))}) plus HRA (${formatMoney(fromPaise(hra))}) ` +
        `exceed gross (${formatMoney(fromPaise(gross))}). Adjust the salary structure.`,
    };
  }
  return {
    ok: true,
    gross: fromPaise(gross),
    basic: fromPaise(basic),
    hra: fromPaise(hra),
    special: fromPaise(gross - basic - hra),
  };
}

/**
 * Load one employee's full editable fields for the edit drawer. Although this
 * is a read, it returns Aadhaar, PAN, bank details and salary — so it is gated
 * like the write that follows it, not left to the employees read policy alone
 * (which lets every portal reader read all employees).
 */
export async function fetchEmployeeForEdit(code: string): Promise<EmployeeEditRow | null> {
  const gate = await requireStaff('Loading an employee for editing');
  if (!gate.ok) return null;
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
 * Resolve the submitted branch to its id AND its canonical name.
 *
 * Pick-or-create, the same shape as resolveDepartmentId — except creation is an
 * explicit option rather than free text, because a branch also needs a state
 * and mistyping a name must not silently spawn a new branch.
 *
 * The name is returned because employees.branch_name is denormalised — see
 * the write sites below — and reading it back from the branch row rather than
 * echoing the form value is what keeps 'pune' from being stored where the
 * branch is really called 'Pune'.
 */
async function resolveBranch(
  dbc: DbClient,
  formData: FormData,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const selected = String(formData.get('branch') ?? '').trim();

  if (selected !== NEW_BRANCH) {
    if (!selected) return { ok: false, error: 'Pick a branch.' };
    const { data, error } = await dbc
      .from('branches')
      .select('id, name')
      .eq('name', selected)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: `Unknown branch: ${selected}` };
    return { ok: true, id: data.id, name: data.name };
  }

  const name = String(formData.get('branch_new_name') ?? '').trim();
  const state = String(formData.get('branch_new_state') ?? '').trim();
  if (!name) return { ok: false, error: 'Enter the new branch name.' };
  // INDIAN_STATES mirrors the branches validator's state enum; the validator
  // still has the final word — a mismatch surfaces as a DB error below.
  if (!(INDIAN_STATES as readonly string[]).includes(state)) {
    return { ok: false, error: 'Pick the new branch state or union territory.' };
  }

  // Case-insensitive match first so 'pune'/'Pune' can't spawn duplicates
  // (branches.name is unique, but only case-sensitively).
  const { data: found, error: findError } = await dbc
    .from('branches')
    .select('id, name')
    .ilike('name', name)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };
  if (found) return { ok: true, id: found.id, name: found.name };

  const { data: created, error } = await dbc
    .from('branches')
    .insert({ name, state })
    .select('id, name')
    .single();
  if (error) {
    // Unique race: someone created it between our lookup and insert — use theirs.
    if (error.code === '23505') {
      const { data: raced } = await dbc
        .from('branches')
        .select('id, name')
        .ilike('name', name)
        .maybeSingle();
      if (raced) return { ok: true, id: raced.id, name: raced.name };
    }
    // The 22P02 (invalid enum input) branch is gone with Postgres: an
    // unknown state now fails the collection validator as 23514, and its
    // message already says which value was rejected.
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
  if (!dept) return null;
  const { data: found } = await dbc
    .from('departments')
    .select('id, name')
    .eq('branch_id', branchId)
    .ilike('name', dept)
    .maybeSingle();
  if (found) return { id: found.id, name: found.name };
  const { data: created, error } = await dbc
    .from('departments')
    .insert({ name: dept, branch_id: branchId })
    .select('id, name')
    .single();
  if (error) throw error;
  return { id: created!.id, name: created!.name };
}

/**
 * Give a brand-new (or rehired) employee their paid-leave row for the CURRENT
 * year immediately, instead of waiting for January's cron or someone pressing
 * "Open leave year". BEST-EFFORT like startOnboarding: the RPC is idempotent
 * (`on conflict do nothing`), touches only MISSING rows — nobody is credited
 * twice — and skips joiners dated beyond the year, whom the annual cron will
 * pick up. A failure here must never undo a saved
 * employee; the /leave pool card still shows the gap and its button closes it.
 */
async function provisionCurrentLeaveYear(
  dbc: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  // Business year in IST, matching the provisioning cron — not the server TZ.
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()),
  );
  await dbc.rpc('fn_provision_leave_balances', { p_year: year });
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

  const pan = parsePan(formData.get('pan'));
  if (!pan.ok) return pan;

  const extra = parseBankAndEmergency(formData);
  if (!extra.ok) return extra;

  const dbc = await createClient();

  // The branch arrives as a NAME (or the add-new sentinel); resolve to an id,
  // creating the branch when that was explicitly requested.
  const branch = await resolveBranch(dbc, formData);
  if (!branch.ok) return branch;

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
      // DENORMALISED, and written on every create and update.
      //
      // The port replaced the branches/departments join with these columns —
      // views.ts groups the board by branch_name, fn_on_leave_today reads it,
      // and getEmployees renders `branch_name ?? ''` with no join to fall back
      // on. Nothing wrote them: only renaming a branch back-filled the column
      // (actions/branches.ts), so until someone renamed a branch every
      // employee had null and the whole company grouped under 'Unassigned'.
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
  // a template that does not exist yet must not fail
  // a saved employee — HR can start it by hand from /onboarding.
  const newEmployeeId = (data![0] as { id: string }).id;
  await startOnboarding(newEmployeeId).catch(() => undefined);

  // Their 15-day paid-leave pool, so approving their first leave deducts from a
  // real balance instead of warning "no balance on record".
  await provisionCurrentLeaveYear(dbc).catch(() => undefined);

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

  const pan = parsePan(formData.get('pan'));
  if (!pan.ok) return pan;

  const extra = parseBankAndEmergency(formData);
  if (!extra.ok) return extra;

  const dbc = await createClient();

  const branch = await resolveBranch(dbc, formData);
  if (!branch.ok) return branch;

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
      // DENORMALISED, and written on every create and update.
      //
      // The port replaced the branches/departments join with these columns —
      // views.ts groups the board by branch_name, fn_on_leave_today reads it,
      // and getEmployees renders `branch_name ?? ''` with no join to fall back
      // on. Nothing wrote them: only renaming a branch back-filled the column
      // (actions/branches.ts), so until someone renamed a branch every
      // employee had null and the whole company grouped under 'Unassigned'.
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
    .select('id');

  if (error) {
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

  const dbc = await createClient();
  const { data, error } = await dbc
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

  const dbc = await createClient();
  const { data, error } = await dbc
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

  // A rehire was invisible to provisioning while inactive — fill the missing
  // paid-leave row for the current year. Idempotent and best-effort (above).
  await provisionCurrentLeaveYear(dbc).catch(() => undefined);

  revalidatePath('/employees');
  revalidatePath('/leave');
  return { ok: true };
}
