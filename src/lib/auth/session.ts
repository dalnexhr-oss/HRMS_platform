// Resolve the session cookie into { userId, email, profile }. Verify the JWT, then check
// token_version and disabled on the user record. React cache shares the database lookup within a
// request.
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { sessionCookie } from '@/lib/auth/session-shared';
import { usersCollection } from '@/lib/db/collections';
import { signSession, verifySession, sessionMaxAgeSeconds } from '@/lib/auth/jwt';
import type { SessionClaims } from '@/lib/auth/jwt';
import type { UserDoc } from '@/lib/db/collections';
import type { AppRole, Profile } from '@/types/database';

// Re-exported so callers have one import for everything session-related.
export { sessionCookie };

export interface SessionContext {
  userId: string | null;
  email: string | null;
  profile: Profile | null;
}

const empty: SessionContext = { userId: null, email: null, profile: null };

// Cookie attributes. Shared by the set and clear paths so they cannot drift.
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

// The users collection's document shape, minus the fields views never need.
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

// Issue a token for `user` and write the session cookie. Callable only where cookies are writable —
// Server Actions and Route Handlers, not Server Components.
export async function createSession(user: UserDoc): Promise<void> {
  const claims: SessionClaims = {
    sub: user._id,
    email: user.email,
    role: user.role,
    eid: user.employee_id,
    ver: user.token_version,
  };
  const token = await signSession(claims);
  (await cookies()).set(sessionCookie, token, cookieOptions(sessionMaxAgeSeconds));
}

// Clear this browser's cookie. Sign-out must also call revokeAllSessions to invalidate other
// copies of the token.
export async function destroySession(): Promise<void> {
  (await cookies()).set(sessionCookie, '', cookieOptions(0));
}

// Invalidate every token issued to an account, on every device. Call on sign-out, password change,
// role change, and when disabling a login. Returns the new version, or null when the user no longer
// exists.
export async function revokeAllSessions(userId: string): Promise<number | null> {
  const users = await usersCollection();
  const result = await users.findOneAndUpdate(
    { _id: userId },
    { $inc: { token_version: 1 }, $set: { updated_at: new Date() } },
    { returnDocument: 'after', projection: { token_version: 1 } },
  );
  return result?.token_version ?? null;
}

// The raw token, unverified. Use getSession() unless you need the string.
export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(sessionCookie)?.value ?? null;
}

// Resolve the user once per request. Invalid, revoked, disabled, or missing sessions return empty;
// database outages still throw.
export const getSession = cache(async function getSession(): Promise<SessionContext> {
  const token = await readSessionToken();
  if (!token) {
    return empty;
  }

  const claims = await verifySession(token);
  if (!claims) {
    return empty;
  }

  const users = await usersCollection();
  const user = await users.findOne({ _id: claims.sub });
  if (!user) {
    return empty;
  }

  // The two revocation checks. Either one failing means this token is spent.
  if (user.disabled) {
    return empty;
  }
  if (user.token_version !== claims.ver) {
    return empty;
  }

  return { userId: user._id, email: user.email, profile: toProfile(user) };
});

// The full user document for the signed-in account, or null.
export const getSessionUser = cache(async function getSessionUser(): Promise<UserDoc | null> {
  const token = await readSessionToken();
  if (!token) {
    return null;
  }

  const claims = await verifySession(token);
  if (!claims) {
    return null;
  }

  const users = await usersCollection();
  const user = await users.findOne({ _id: claims.sub });
  if (!user || user.disabled || user.token_version !== claims.ver) {
    return null;
  }
  return user;
});

// Refresh the cookie after claim changes the caller should survive, such as their own password
// update and token_version bump.
export async function refreshSession(userId: string): Promise<void> {
  const users = await usersCollection();
  const user = await users.findOne({ _id: userId });
  if (user && !user.disabled) {
    await createSession(user);
  }
}

// True when the role belongs to the staff portal. Mirrors lib/auth.ts.
export function isStaffRole(role: AppRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin' || role === 'hr';
}
