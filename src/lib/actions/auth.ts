'use server';

// ============================================================================
// Sign in and sign out. Replaces the GoTrue calls that lived here.
//
// Runs on Node, not the edge: verifying a password needs node:crypto's scrypt.
// ============================================================================
import { redirect } from 'next/navigation';
import { homeForRole } from '@/lib/auth';
import { isAuthConfigured } from '@/lib/auth/jwt';
import {
  createSession,
  destroySession,
  getSession,
  revokeAllSessions,
} from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { usersCollection } from '@/lib/db/collections';
import { isMongoConfigured } from '@/lib/db/mongo';

export interface SignInState {
  error?: string;
}

/**
 * One message for every credential failure — unknown email, wrong password,
 * disabled account. Telling them apart is a free account-enumeration oracle,
 * and none of the three is something the visitor can act on differently.
 */
const BAD_CREDENTIALS = 'That email and password do not match an account.';

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '');

  if (!isMongoConfigured()) {
    return { error: 'The database is not configured. Set MONGO_URI in .env.local.' };
  }
  if (!isAuthConfigured()) {
    return { error: 'Sign-in is not configured. Set AUTH_SECRET in .env.local.' };
  }
  if (!email || !password) return { error: 'Enter your email and password.' };

  const users = await usersCollection();
  // Collation must match the unique index, or a user who registered as
  // Rahul@x.com cannot sign in as rahul@x.com.
  const user = await users.findOne(
    { email },
    { collation: { locale: 'en', strength: 2 } },
  );

  // Verify against a dummy hash when the user is absent so the response time
  // does not reveal whether the address exists.
  const stored = user?.password_hash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, stored);

  if (!user || !ok || user.disabled) return { error: BAD_CREDENTIALS };

  await users.updateOne({ _id: user._id }, { $set: { last_sign_in_at: new Date() } });
  await createSession(user);

  // Only same-origin paths — see safeRedirectPath().
  const safeNext = safeRedirectPath(next);

  // redirect() throws to interrupt rendering, so it must be the last statement.
  // The cast is needed because typedRoutes narrows the parameter to known
  // routes, and `next` is only known to be a safe relative path at runtime.
  redirect((safeNext ?? homeForRole(user.role)) as Parameters<typeof redirect>[0]);
}

/**
 * Sign out everywhere, not just here.
 *
 * Clearing the cookie only affects this browser, and the token stays valid for
 * the rest of its year. Bumping token_version is what actually revokes it, so
 * a copy taken from a shared machine stops working too.
 */
export async function signOut() {
  const { userId } = await getSession();
  if (userId) await revokeAllSessions(userId);
  await destroySession();
  redirect('/login');
}

// A real scrypt hash of a random string, used only to spend the same CPU time
// on a missing account as on a real one. Its plaintext is unknown and unused.
const DUMMY_HASH =
  'scrypt$65536$8$1$CftBGH0+i21Hii5EPwDwQg==$CsAkgiwdSpCsLUVtHuOVbTMKVzfOfRfzRHrH+962fr+pEP6ZSr0n2BNFkhPBOxBMn8m8o/Bd2imihYsJE2m9Ng==';
