'use server';

// ============================================================================
// User administration — admin/HR create and manage login accounts.
//
// Ported from GoTrue's auth.admin.* API to the users collection. The privilege
// rules below are UNCHANGED and are the important part of this file: with RLS
// gone, they are the only thing standing between an HR account and a super
// admin session, so they run before any write, every time.
//
// What changed with the port: there is no service-role client to gate on any
// more. Under Supabase these functions needed a key that bypassed RLS, so
// "is the privileged client available" was a real precondition. Now every
// query is equally privileged, which makes the caller's own role check the
// whole of the defence rather than the outer half of it.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { requireRoles } from '@/lib/actions/_guard';
import { isEmployeeAreaRole } from '@/lib/auth';
// validatePassword, not a local minimum: an admin-set password used to be held
// to 8 characters while every self-service path required 10, so /users could
// provision a password the same person was then forbidden to choose. It also
// carries the 200-character CEILING, which nothing here enforced at all —
// scrypt at N=65536 was being run over an unbounded input on a public endpoint.
import { hashPassword, validatePassword } from '@/lib/auth/password';
import { createResetToken, RESET_TOKEN_TTL_MINUTES } from '@/lib/auth/reset-tokens';
import { appOrigin, ORIGIN_NOT_CONFIGURED } from '@/lib/auth/origin';
import { COLLECTIONS, usersCollection, type UserDoc } from '@/lib/db/collections';
import { db, isMongoConfigured } from '@/lib/db/mongo';
import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email';
import type { AppRole } from '@/types/database';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Roles allowed to administer users. */
const USER_ADMIN_ROLES: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

// Roles that may be assigned through this screen. NOT exported: a 'use server'
// module may only export async functions, so the UI keeps its own display list.
const ASSIGNABLE_ROLES: readonly AppRole[] = ['super_admin', 'admin', 'hr', 'employee', 'intern'];

/**
 * User administration is TIERED, and every rule below derives from this one map.
 *
 * A caller may only grant a role, or act on an account holding a role, at or
 * below their own tier. The escalation this closes is not theoretical: before it,
 * updateUserRole checked only for the literal 'admin', so an HR account could set
 * anyone's role — including its own — to 'super_admin' and take the top tier in a
 * single request. Server Actions are public endpoints, so the UI never offering
 * the option was no defence.
 */
const ROLE_TIER: Record<AppRole, number> = {
  super_admin: 3,
  admin: 2,
  hr: 1,
  employee: 0,
  // Same tier as an employee: no portal, nothing to escalate to.
  intern: 0,
};

function tierOf(role: AppRole | null | undefined): number {
  return role ? ROLE_TIER[role] ?? 0 : 0;
}

/** Role name as it reads in a refusal message. */
const TIER_LABEL: Record<AppRole, string> = {
  super_admin: 'super admin',
  admin: 'admin',
  hr: 'HR',
  employee: 'employee',
  intern: 'intern',
};


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Case-insensitive lookup, matching the users_email_unique index. */
const EMAIL_COLLATION = { locale: 'en', strength: 2 } as const;

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
  /** No GoTrue equivalent — replaces "banned" and is checked on every request. */
  disabled: boolean;
}

function databaseUnavailable(): ActionResult {
  return {
    ok: false,
    error: 'The database is not configured.',
  };
}

/**
 * Refuse to let a non-admin act ON an account that outranks them.
 *
 * Without this, an 'hr' user could call setUserPassword('<admin-id>', '…')
 * straight over HTTP — Server Actions are public endpoints, so the UI not
 * showing a button is irrelevant — and sign in as that admin. That is strictly
 * worse than the escalation createUser/updateUserRole already refuse, because it
 * hands over an EXISTING admin session. Every path that mutates or can seize
 * another account must call this.
 */
async function assertMayActOnTarget(
  targetUserId: string,
  callerRole: AppRole,
): Promise<{ ok: true; target: UserDoc } | { ok: false; error: string }> {
  const users = await usersCollection();
  const target = await users.findOne({ _id: targetUserId });
  if (!target) return { ok: false, error: 'That account no longer exists.' };
  if (tierOf(target.role) > tierOf(callerRole)) {
    const label = TIER_LABEL[target.role];
    return { ok: false, error: `Only a ${label} account can manage another ${label} account.` };
  }
  return { ok: true, target };
}

/**
 * Resolve employee code/name for the accounts that link to one.
 *
 * Reads the employees collection directly rather than $lookup: the set is one
 * page of users, so a single $in is cheaper than a pipeline, and it keeps
 * working while employees is still being ported — an absent collection simply
 * yields no names instead of failing the whole screen.
 */
async function employeeLabels(
  ids: string[],
): Promise<Map<string, { code: string | null; name: string | null }>> {
  const out = new Map<string, { code: string | null; name: string | null }>();
  if (ids.length === 0) return out;

  const database = await db();
  const rows = await database
    .collection<{ _id: string; code?: string; full_name?: string }>(COLLECTIONS.employees)
    .find({ _id: { $in: ids } }, { projection: { code: 1, full_name: 1 } })
    .toArray();

  for (const row of rows) {
    out.set(row._id, { code: row.code ?? null, name: row.full_name ?? null });
  }
  return out;
}

/** Every login account with its role and linked employee. */
export async function listUsers(): Promise<
  { ok: true; users: ManagedUser[] } | { ok: false; error: string }
> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Viewing user accounts');
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isMongoConfigured()) return databaseUnavailable() as { ok: false; error: string };

  try {
    const users = await usersCollection();
    // password_hash is projected away rather than deleted afterwards: it must
    // never travel to a client component, and the safest way to guarantee that
    // is for it to never leave the database.
    const docs = await users
      .find({}, { projection: { password_hash: 0 } })
      .sort({ email: 1 })
      .toArray();

    const labels = await employeeLabels(
      docs.map((d) => d.employee_id).filter((id): id is string => typeof id === 'string'),
    );

    const list: ManagedUser[] = docs.map((u) => {
      const label = u.employee_id ? labels.get(u.employee_id) : undefined;
      return {
        id: u._id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
        employeeId: u.employee_id,
        employeeCode: label?.code ?? null,
        employeeName: label?.name ?? null,
        lastSignInAt: u.last_sign_in_at ? u.last_sign_in_at.toISOString() : null,
        createdAt: u.created_at.toISOString(),
        disabled: u.disabled,
      };
    });

    return { ok: true, users: list };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not list users.' };
  }
}

/**
 * Create a login account with its role and employee link.
 *
 * The password is set directly and the address marked verified, so the account
 * works immediately even where SMTP is not configured. The user can change it
 * from "My account", and an admin can trigger a reset email.
 */
export async function createUser(formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Adding a user');
  if (!gate.ok) return gate;
  if (!isMongoConfigured()) return databaseUnavailable();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const fullName = String(formData.get('full_name') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim() as AppRole;
  const employeeId = String(formData.get('employee_id') ?? '').trim() || null;

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  const weak = validatePassword(password);
  if (weak) return { ok: false, error: weak };
  if (!fullName) return { ok: false, error: 'Enter the person’s full name.' };
  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'Choose a role.' };

  // No minting a role above your own tier: a super admin only by a super admin,
  // an admin by an admin or a super admin.
  if (tierOf(role) > tierOf(gate.role)) {
    return {
      ok: false,
      error: `Only a ${TIER_LABEL[role]} account can create another ${TIER_LABEL[role]} account.`,
    };
  }
  // An employee login is useless without a record to read. Every OTHER role may
  // carry one too and usually should: an admin or HR person is normally on the
  // payroll as well, and the link is what gives them their own attendance,
  // payslips and leave.
  if (isEmployeeAreaRole(role) && !employeeId) {
    return { ok: false, error: 'Pick which employee this login belongs to.' };
  }

  try {
    const users = await usersCollection();
    const now = new Date();

    await users.insertOne({
      _id: randomUUID(),
      email,
      password_hash: await hashPassword(password),
      full_name: fullName,
      role,
      branch_id: null,
      avatar: null,
      employee_id: employeeId,
      disabled: false,
      token_version: 0,
      tab_access: {},
      email_verified_at: now,
      last_sign_in_at: null,
      created_at: now,
      updated_at: now,
    });

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    // 11000 is a unique-index violation. Which index decides the message —
    // "email taken" and "that employee already has a login" are different
    // problems with different fixes.
    if (isDuplicateKey(e)) {
      const message = String((e as { message?: string }).message ?? '');
      if (message.includes('users_employee_unique')) {
        return { ok: false, error: 'That employee already has a login account.' };
      }
      return { ok: false, error: `An account already exists for ${email}.` };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the user.' };
  }
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

/** Change an existing account's role (and employee link when it becomes one). */
export async function updateUserRole(
  userId: string,
  role: AppRole,
  employeeId: string | null,
): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Changing a user’s role');
  if (!gate.ok) return gate;
  if (!isMongoConfigured()) return databaseUnavailable();

  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'Choose a valid role.' };
  // No granting a role above your own tier. The absence of this check is what let
  // an HR account promote itself to super_admin.
  if (tierOf(role) > tierOf(gate.role)) {
    return { ok: false, error: `Only a ${TIER_LABEL[role]} account can grant the ${TIER_LABEL[role]} role.` };
  }
  if (isEmployeeAreaRole(role) && !employeeId) {
    return { ok: false, error: 'Pick which employee this login belongs to.' };
  }
  // Nobody changes their OWN role — a super admin included. Other people's roles
  // are exactly what this screen is for; your own is the one row you must not
  // touch. Self-service is how an account either demotes itself into lockout or
  // quietly rewrites its own privileges with no second party involved, and the
  // tier rule above cannot catch the latter: a caller always outranks themselves.
  if (userId === gate.profileId && role !== gate.role) {
    return {
      ok: false,
      error: `You cannot change your own role — ask another ${TIER_LABEL[gate.role]} to do it.`,
    };
  }

  try {
    // HR must not be able to demote or seize a higher-tier account.
    const allowed = await assertMayActOnTarget(userId, gate.role);
    if (!allowed.ok) return allowed;

    const users = await usersCollection();
    const result = await users.updateOne(
      { _id: userId },
      { $set: { role, employee_id: employeeId, updated_at: new Date() } },
    );
    if (result.matchedCount === 0) return { ok: false, error: 'That account no longer exists.' };

    // No token_version bump: getSession() reads the role from this document on
    // every request, so a demotion takes effect on the target's very next page
    // load without signing them out mid-task. The role in the JWT is carried for
    // logging only and is never trusted for authorization.

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    if (isDuplicateKey(e)) {
      return { ok: false, error: 'That employee already has a login account.' };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update the role.' };
  }
}

/**
 * Delete a login account.
 *
 * The EMPLOYEE record is deliberately left alone — attendance, payslips and
 * claims must survive the login being removed; use "Deactivate" on /employees
 * for the person. This only removes their ability to sign in.
 *
 * Postgres cascaded profiles and reset tokens away via ON DELETE CASCADE.
 * MongoDB has no such thing, so the dependent cleanup is explicit below —
 * leaving a live reset token behind would let someone redeem it and recreate
 * access to a deleted account.
 *
 * Guards, in order of how badly they'd hurt:
 *  - you cannot delete yourself (instant self-lockout),
 *  - you cannot delete an account that outranks you (privilege inversion),
 *  - the last admin (or last super admin) cannot be deleted (locks everyone out).
 */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Deleting a user');
  if (!gate.ok) return gate;
  if (!isMongoConfigured()) return databaseUnavailable();

  if (!userId) return { ok: false, error: 'No account selected.' };
  if (userId === gate.profileId) {
    return { ok: false, error: 'You cannot delete your own account.' };
  }

  try {
    const allowed = await assertMayActOnTarget(userId, gate.role);
    if (!allowed.ok) return allowed;
    const target = allowed.target;

    const users = await usersCollection();

    // Never empty an administrative tier — that locks everyone out of /users.
    if (target.role === 'admin' || target.role === 'super_admin') {
      const label = TIER_LABEL[target.role];
      const count = await users.countDocuments({ role: target.role }, { limit: 2 });
      if (count <= 1) {
        return {
          ok: false,
          error: `This is the last ${label} account — promote another before deleting it.`,
        };
      }
    }

    const result = await users.deleteOne({ _id: userId });
    if (result.deletedCount === 0) return { ok: false, error: 'That account no longer exists.' };

    // Explicit cascade — see the note above.
    const database = await db();
    await database.collection('password_reset_tokens').deleteMany({ user_id: userId });

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete the user.' };
  }
}

/**
 * Enable or disable an account's ability to sign in.
 *
 * New with the port, and the safer alternative to deleting: a year-long token
 * cannot be recalled, so `disabled` is how a departing employee's live session
 * is stopped without destroying the account and its audit trail.
 */
export async function setUserDisabled(userId: string, disabled: boolean): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Changing sign-in access');
  if (!gate.ok) return gate;
  if (!isMongoConfigured()) return databaseUnavailable();

  if (userId === gate.profileId) {
    return { ok: false, error: 'You cannot disable your own account.' };
  }

  try {
    const allowed = await assertMayActOnTarget(userId, gate.role);
    if (!allowed.ok) return allowed;

    const users = await usersCollection();
    await users.updateOne(
      { _id: userId },
      {
        $set: { disabled, updated_at: new Date() },
        // Disabling revokes outstanding tokens as well as blocking new sign-ins,
        // so re-enabling later cannot silently resurrect an old cookie.
        ...(disabled ? { $inc: { token_version: 1 } } : {}),
      },
    );

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not change access.' };
  }
}

/** Admin-triggered password reset email (the user then sets their own). */
export async function sendPasswordReset(email: string): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Sending a password reset');
  if (!gate.ok) return gate;
  if (!isMongoConfigured()) return databaseUnavailable();

  try {
    const users = await usersCollection();
    const target = await users.findOne(
      { email: email.trim().toLowerCase() },
      { collation: EMAIL_COLLATION },
    );
    // Unlike the public reset form, this one DOES report a missing account: the
    // caller is an authenticated admin who can already list every address, so
    // there is no enumeration to protect against, and silence would just look
    // like a broken button.
    if (!target) return { ok: false, error: 'No account exists for that email.' };

    // A recovery link is an account-takeover primitive if it reaches the wrong
    // inbox, so the same tier rule applies as for setting a password outright.
    const allowed = await assertMayActOnTarget(target._id, gate.role);
    if (!allowed.ok) return allowed;

    if (!isEmailConfigured()) {
      return {
        ok: false,
        error:
          'Email is not configured, so no reset link can be sent. Set SMTP_HOST and ' +
          'EMAIL_FROM, or use “Set password” instead.',
      };
    }

    // Resolved BEFORE the token is minted: an origin we cannot build a link
    // from would otherwise burn a single-use token on an email nobody can act
    // on. Falling back to '' produced exactly that — `href="/auth/…"` in an
    // email client, which resolves against nothing.
    const origin = await appOrigin();
    if (!origin) return { ok: false, error: ORIGIN_NOT_CONFIGURED };

    const token = await createResetToken(target._id);
    const link = `${origin}/auth/update-password?token=${encodeURIComponent(token)}`;

    const result = await sendEmail({
      to: target.email,
      subject: 'Reset your Dalnex HRMS password',
      text:
        `Hello ${target.full_name ?? ''},\n\n` +
        `An administrator has started a password reset for your account. Open this link ` +
        `to choose a new password. It expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can ` +
        `be used once:\n\n${link}\n`,
      // full_name is admin-supplied, so it is escaped before it reaches the
      // HTML body — see escapeHtml(). The text part needs no escaping.
      html:
        `<p>Hello ${escapeHtml(target.full_name ?? '')},</p>` +
        `<p>An administrator has started a password reset for your account.</p>` +
        `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>` +
        `<p>The link expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can be used once.</p>`,
    });
    if (!result.ok) return { ok: false, error: result.error ?? 'The email could not be sent.' };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send the reset.' };
  }
}

/** Set a new password for an account directly (admin/HR, e.g. no email access). */
export async function setUserPassword(userId: string, password: string): Promise<ActionResult> {
  const gate = await requireRoles(USER_ADMIN_ROLES, 'Setting a password');
  if (!gate.ok) return gate;
  if (!isMongoConfigured()) return databaseUnavailable();

  const weak = validatePassword(password);
  if (weak) return { ok: false, error: weak };

  try {
    // The takeover primitive: setting a password IS signing in as that person.
    const allowed = await assertMayActOnTarget(userId, gate.role);
    if (!allowed.ok) return allowed;

    const users = await usersCollection();
    const result = await users.updateOne(
      { _id: userId },
      {
        $set: { password_hash: await hashPassword(password), updated_at: new Date() },
        // The point of an admin resetting a password is usually that the account
        // is compromised or the person has left. Leaving their year-long cookie
        // alive would make the reset cosmetic.
        $inc: { token_version: 1 },
      },
    );
    if (result.matchedCount === 0) return { ok: false, error: 'That account no longer exists.' };

    // Any outstanding reset link is now stale — drop it rather than leaving a
    // second, older credential live.
    const database = await db();
    await database.collection('password_reset_tokens').deleteMany({ user_id: userId });

    revalidatePath('/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not set the password.' };
  }
}
