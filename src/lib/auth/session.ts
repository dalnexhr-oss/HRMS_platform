// ============================================================================
// The session cookie, and resolving it into a signed-in user.
//
// Replaces @dbc/ssr's cookie handling and lib/auth.ts's getSession().
// The returned shape is deliberately IDENTICAL to the old SessionContext
// ({ userId, email, profile }) so the 56 existing call sites keep working
// unchanged — the port happens underneath them.
//
// Two-layer check, and both layers matter:
//   1. The JWT signature and expiry — cheap, no I/O, works on the edge.
//   2. token_version and disabled, read from the user document — this is what
//      makes sign-out and account lockout take effect on a year-long token.
//
// Layer 2 needs a database round trip, so it is memoised per request with
// React cache(). One navigation touches getSession() from the layout, the page
// and every Server Action guard; without the cache that is three queries.
// ============================================================================
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import {
  signSession,
  verifySession,
  SESSION_MAX_AGE_SECONDS,
  type SessionClaims,
} from '@/lib/auth/jwt';
import { SESSION_COOKIE } from '@/lib/auth/session-shared';
import { usersCollection, type UserDoc } from '@/lib/db/collections';
import type { AppRole, Profile } from '@/types/database';

// Re-exported so callers have one import for everything session-related.
export { SESSION_COOKIE };

export interface SessionContext {
  userId: string | null;
  email: string | null;
  profile: Profile | null;
}

const EMPTY: SessionContext = { userId: null, email: null, profile: null };

/** Cookie attributes. Shared by the set and clear paths so they cannot drift. */
function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // 'lax' still sends the cookie on top-level navigation into the app, so
    // links from email work, while blocking it on cross-site POSTs.
    sameSite: 'lax' as const,
    // Never require HTTPS in dev or the cookie is silently dropped on
    // http://localhost and sign-in appears to do nothing.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

/** The users collection's document shape, minus the fields views never need. */
function toProfile(user: UserDoc): Profile {
  return {
    id: user._id,
    full_name: user.full_name,
    role: user.role,
    branch_id: user.branch_id,
    employee_id: user.employee_id,
    avatar: user.avatar,
    // Profile.created_at is a string in the app's types (it came from JSON).
    created_at: user.created_at.toISOString(),
  };
}

/**
 * Issue a token for `user` and write the session cookie.
 *
 * Callable only where cookies are writable — Server Actions and Route Handlers,
 * not Server Components.
 */
export async function createSession(user: UserDoc): Promise<void> {
  const claims: SessionClaims = {
    sub: user._id,
    email: user.email,
    role: user.role,
    eid: user.employee_id,
    ver: user.token_version,
  };
  const token = await signSession(claims);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_SECONDS));
}

/**
 * Clear the cookie on this device.
 *
 * This alone does NOT invalidate the token — anyone holding a copy could still
 * use it for the rest of the year. Sign-out therefore also bumps token_version
 * (see revokeAllSessions), which is the half that actually revokes.
 */
export async function destroySession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', cookieOptions(0));
}

/**
 * Invalidate every token issued to an account, on every device.
 *
 * Call on sign-out, password change, role change, and when disabling a login.
 * Returns the new version, or null when the user no longer exists.
 */
export async function revokeAllSessions(userId: string): Promise<number | null> {
  const users = await usersCollection();
  const result = await users.findOneAndUpdate(
    { _id: userId },
    { $inc: { token_version: 1 }, $set: { updated_at: new Date() } },
    { returnDocument: 'after', projection: { token_version: 1 } },
  );
  return result?.token_version ?? null;
}

/** The raw token, unverified. Use getSession() unless you need the string. */
export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Resolve the signed-in user. Memoised per request.
 *
 * Returns EMPTY for every failure mode — no cookie, bad signature, expired,
 * revoked, disabled, deleted — because none of them is a state the UI can act
 * on differently, and distinguishing them for the visitor leaks account
 * existence. A database that is genuinely unreachable still throws, so a broken
 * connection never masquerades as "signed out".
 */
export const getSession = cache(async function getSession(): Promise<SessionContext> {
  const token = await readSessionToken();
  if (!token) return EMPTY;

  const claims = await verifySession(token);
  if (!claims) return EMPTY;

  const users = await usersCollection();
  const user = await users.findOne({ _id: claims.sub });
  if (!user) return EMPTY;

  // The two revocation checks. Either one failing means this token is spent.
  if (user.disabled) return EMPTY;
  if (user.token_version !== claims.ver) return EMPTY;

  return { userId: user._id, email: user.email, profile: toProfile(user) };
});

/** The full user document for the signed-in account, or null. */
export const getSessionUser = cache(async function getSessionUser(): Promise<UserDoc | null> {
  const token = await readSessionToken();
  if (!token) return null;

  const claims = await verifySession(token);
  if (!claims) return null;

  const users = await usersCollection();
  const user = await users.findOne({ _id: claims.sub });
  if (!user || user.disabled || user.token_version !== claims.ver) return null;
  return user;
});

/**
 * Re-issue the cookie so it reflects the user's current claims.
 *
 * Needed after a role change or a token_version bump the user should survive
 * (their own password change, say) — otherwise their next request fails the
 * version check and signs them out.
 */
export async function refreshSession(userId: string): Promise<void> {
  const users = await usersCollection();
  const user = await users.findOne({ _id: userId });
  if (user && !user.disabled) await createSession(user);
}

/** True when the role belongs to the staff portal. Mirrors lib/auth.ts. */
export function isStaffRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'hr';
}
