'use server';

// ============================================================================
// User administration — admin/HR create and manage login accounts.
//
// Creating an auth user needs the SERVICE-ROLE key, which bypasses RLS
// entirely. Every function here therefore gates on the caller's own profile
// role BEFORE touching the privileged client; the service client is never
// reachable from an unauthenticated or under-privileged request.
//
// Privilege escalation guard: HR may create hr/manager/viewer/employee accounts,
// but only an ADMIN may create or assign the 'admin' role — otherwise HR could
// mint themselves an admin and step over their own ceiling.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createServiceClient, isServiceRoleConfigured } from '@/lib/supabase/server';
import { requireRoles } from '@/lib/actions/_guard';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Roles allowed to administer users. */
const USER_ADMIN_ROLES: readonly AppRole[] = ['admin', 'hr'];

// Roles that may be assigned through this screen. NOT exported: a 'use server'
// module may only export async functions, so the UI keeps its own display list.
const ASSIGNABLE_ROLES: readonly AppRole[] = ['admin', 'hr', 'manager', 'viewer', 'employee'];

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ManagedUser {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole | null;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  lastSignInAt: string | null;
  createdAt: string;
}

function serviceUnavailable(): ActionResult {
  return {
    ok: false,
    error:
      'User administration needs the Supabase secret key. Set SUPABASE_SECRET_KEY ' +
      '(sb_secret_…) — or the legacy SUPABASE_SERVICE_ROLE_KEY — in .env.local and restart.',
  };
}

/**
 * Refuse to let a non-admin act ON an admin account.
 *
 * Without this, an 'hr' user could call setUserPassword('<admin-uuid>', '…')
 * straight over HTTP — Server Actions are public endpoints, so the UI not
 * showing a button is irrelevant — and sign in as that admin. That is strictly
 * worse than the escalation createUser/updateUserRole already refuse, because it
 * hands over an EXISTING admin session. Every service-role path that mutates or
 * can seize another account must call this.
 */
async function assertMayActOnTarget(
  admin: ReturnType<typeof createServiceClient>,
  targetUserId: string,
  callerRole: AppRole,
): Promise<{ ok: true; targetRole: AppRole | null } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('profiles')
    .select('role')
    .eq('id', targetUserId)
    .maybeSingle<{ role: AppRole | null }>();
  if (error) return { ok: false, error: `Could not read that account: ${error.message}` };
  if (!data) return { ok: false, error: 'That account no longer exists.' };
  if (data.role === 'admin' && callerRole !== 'admin') {
    return { ok: false, error: 'Only an admin can manage another admin account.' };
  }
  return { ok: true, targetRole: data.role };
}

/**
 * Every login account with its profile role and linked employee.
 * Returns [] with a reason when the service key is absent, so the screen can
 * explain itself rather than showing a misleading empty list.
 */
export async function listUsers(): Promise<
  { ok: true; users: ManagedUser[] } | { ok: false; error: string }
> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Viewing user accounts');
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isServiceRoleConfigured()) return serviceUnavailable() as { ok: false; error: string };

  try {
    const admin = createServiceClient();

    const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return { ok: false, error: `Could not list accounts: ${error.message}` };

    const { data: profiles, error: pErr } = await admin
      .from('profiles')
      .select('id, full_name, role, employee_id, employees(code, full_name)');
    if (pErr) return { ok: false, error: `Could not load profiles: ${pErr.message}` };

    const byId = new Map(
      (profiles ?? []).map((p: any) => [
        p.id,
        {
          fullName: p.full_name as string | null,
          role: p.role as AppRole | null,
          employeeId: p.employee_id as string | null,
          employeeCode: (p.employees?.code ?? null) as string | null,
          employeeName: (p.employees?.full_name ?? null) as string | null,
        },
      ]),
    );

    const users: ManagedUser[] = list.users.map((u) => {
      const p = byId.get(u.id);
      return {
        id: u.id,
        email: u.email ?? '',
        fullName: p?.fullName ?? (u.user_metadata?.full_name as string | undefined) ?? null,
        role: p?.role ?? null,
        employeeId: p?.employeeId ?? null,
        employeeCode: p?.employeeCode ?? null,
        employeeName: p?.employeeName ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at,
      };
    });

    users.sort((a, b) => a.email.localeCompare(b.email));
    return { ok: true, users };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not list users.' };
  }
}

/**
 * Create a login account and set its profile role / employee link.
 * The password is set directly (email_confirm: true) so the account works
 * immediately even where SMTP isn't configured; the user can change it from
 * "My account", and admins can trigger a reset email.
 */
export async function createUser(formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Adding a user');
  if (!gate.ok) return gate;
  if (!isServiceRoleConfigured()) return serviceUnavailable();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const fullName = String(formData.get('full_name') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim() as AppRole;
  const employeeId = String(formData.get('employee_id') ?? '').trim() || null;

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `The password must be at least ${MIN_PASSWORD} characters.` };
  }
  if (!fullName) return { ok: false, error: 'Enter the person’s full name.' };
  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'Choose a role.' };

  // Only an admin may mint another admin.
  if (role === 'admin' && gate.role !== 'admin') {
    return { ok: false, error: 'Only an admin can create another admin account.' };
  }
  // An employee login is useless — and silently broken — without a linked record.
  if (role === 'employee' && !employeeId) {
    return { ok: false, error: 'Pick which employee this login belongs to.' };
  }

  try {
    const admin = createServiceClient();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) {
      if (/registered|already|exists/i.test(error.message)) {
        return { ok: false, error: `An account already exists for ${email}.` };
      }
      return { ok: false, error: error.message };
    }
    const userId = data.user?.id;
    if (!userId) return { ok: false, error: 'The account was created but returned no id.' };

    // handle_new_user() has already inserted a base profile (role 'employee');
    // upsert the intended role and employee link over it.
    const { error: pErr } = await admin
      .from('profiles')
      .upsert({ id: userId, full_name: fullName, role, employee_id: role === 'employee' ? employeeId : null });
    if (pErr) {
      // The login exists but has the wrong role — say so rather than reporting success.
      return {
        ok: false,
        error: `The account was created, but its role could not be set (${pErr.message}). Fix the role before they sign in.`,
      };
    }

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the user.' };
  }
}

/** Change an existing account's role (and employee link when it becomes one). */
export async function updateUserRole(
  userId: string,
  role: AppRole,
  employeeId: string | null,
): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Changing a user’s role');
  if (!gate.ok) return gate;
  if (!isServiceRoleConfigured()) return serviceUnavailable();

  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'Choose a valid role.' };
  if (role === 'admin' && gate.role !== 'admin') {
    return { ok: false, error: 'Only an admin can grant the admin role.' };
  }
  if (role === 'employee' && !employeeId) {
    return { ok: false, error: 'Pick which employee this login belongs to.' };
  }
  // Don't let the last admin demote themselves into lockout.
  if (userId === gate.profileId && gate.role === 'admin' && role !== 'admin') {
    return {
      ok: false,
      error: 'You cannot remove your own admin role — ask another admin to do it.',
    };
  }

  try {
    const admin = createServiceClient();

    // HR must not be able to demote/hijack an existing admin.
    const allowed = await assertMayActOnTarget(admin, userId, gate.role);
    if (!allowed.ok) return allowed;

    const { data, error } = await admin
      .from('profiles')
      .update({ role, employee_id: role === 'employee' ? employeeId : null })
      .eq('id', userId)
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: 'That account no longer exists.' };

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update the role.' };
  }
}

/**
 * Delete a login account.
 *
 * Deleting the auth user cascades to profiles (profiles.id references
 * auth.users ON DELETE CASCADE), so the role/employee link goes with it. The
 * EMPLOYEE record is deliberately left alone — attendance, payslips and claims
 * must survive the login being removed; use "Deactivate" on /employees for the
 * person, this only removes their ability to sign in.
 *
 * Guards, in order of how badly they'd hurt:
 *  - you cannot delete yourself (instant self-lockout),
 *  - HR cannot delete an admin (privilege inversion),
 *  - the last remaining admin cannot be deleted (locks everyone out of /users).
 */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Deleting a user');
  if (!gate.ok) return gate;
  if (!isServiceRoleConfigured()) return serviceUnavailable();

  if (!userId) return { ok: false, error: 'No account selected.' };
  if (userId === gate.profileId) {
    return { ok: false, error: 'You cannot delete your own account.' };
  }

  try {
    const admin = createServiceClient();

    // What are we deleting? Needed for both guards below.
    const { data: target, error: readErr } = await admin
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', userId)
      .maybeSingle<{ id: string; role: AppRole; full_name: string | null }>();
    if (readErr) return { ok: false, error: `Could not read that account: ${readErr.message}` };

    if (target?.role === 'admin') {
      if (gate.role !== 'admin') {
        return { ok: false, error: 'Only an admin can delete another admin account.' };
      }
      const { count, error: countErr } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (countErr) return { ok: false, error: `Could not count admins: ${countErr.message}` };
      if ((count ?? 0) <= 1) {
        return {
          ok: false,
          error: 'This is the last admin account — promote another admin before deleting it.',
        };
      }
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return { ok: false, error: error.message };

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete the user.' };
  }
}

/** Admin-triggered password reset email (the user then sets their own). */
export async function sendPasswordReset(email: string): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Sending a password reset');
  if (!gate.ok) return gate;
  if (!isServiceRoleConfigured()) return serviceUnavailable();

  try {
    const admin = createServiceClient();

    // Resolve the email to an account so the same admin-target rule applies —
    // a recovery link is an account takeover primitive if it reaches the wrong inbox.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return { ok: false, error: listErr.message };
    const target = list.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
    if (!target) return { ok: false, error: 'No account exists for that email.' };

    const allowed = await assertMayActOnTarget(admin, target.id, gate.role);
    if (!allowed.ok) return allowed;

    const { error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send the reset.' };
  }
}

/** Set a new password for an account directly (admin/HR, e.g. no email access). */
export async function setUserPassword(userId: string, password: string): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Setting a password');
  if (!gate.ok) return gate;
  if (!isServiceRoleConfigured()) return serviceUnavailable();

  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `The password must be at least ${MIN_PASSWORD} characters.` };
  }

  try {
    const admin = createServiceClient();

    // The takeover primitive: setting a password IS signing in as that person.
    const allowed = await assertMayActOnTarget(admin, userId, gate.role);
    if (!allowed.ok) return allowed;

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not set the password.' };
  }
}
