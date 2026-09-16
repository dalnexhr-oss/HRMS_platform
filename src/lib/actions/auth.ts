'use server';

// Server Actions for session authentication: sign in, sign out, and active session termination.
import { redirect } from 'next/navigation';
import { homeForRole } from '@/lib/auth';
import { isAuthConfigured } from '@/lib/auth/jwt';
import { createSession, destroySession, getSession, revokeAllSessions } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { usersCollection } from '@/lib/db/collections';
import { isMongoConfigured } from '@/lib/db/mongo';

export interface SignInState {
  error?: string;
}

// Uniform error message for authentication failures to prevent account enumeration.
const badCredentials = 'That email and password do not match an account.';

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '');

  if (!isMongoConfigured()) {
    return { error: 'The database is not configured. Set MONGO_URI in .env.local.' };
  }
  if (!isAuthConfigured()) {
    return { error: 'Sign-in is not configured. Set AUTH_SECRET in .env.local.' };
  }
  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const users = await usersCollection();
  // Collation must match the unique index, or a user who registered as
  // Rahul@x.com cannot sign in as rahul@x.com.
  const user = await users.findOne({ email }, { collation: { locale: 'en', strength: 2 } });

  // Verify against a dummy hash when the user is absent so the response time
  // does not reveal whether the address exists.
  const stored = user?.password_hash ?? dummyHash;
  const ok = await verifyPassword(password, stored);

  if (!user || !ok || user.disabled) {
    return { error: badCredentials };
  }

  await users.updateOne({ _id: user._id }, { $set: { last_sign_in_at: new Date() } });
  await createSession(user);

  // Only same-origin paths — see safeRedirectPath().
  const safeNext = safeRedirectPath(next);

  // redirect() throws to interrupt rendering, so it must be the last statement.
  // The cast is needed because typedRoutes narrows the parameter to known
  // routes, and `next` is only known to be a safe relative path at runtime.
  redirect((safeNext ?? homeForRole(user.role)) as Parameters<typeof redirect>[0]);
}

// Bump token_version to revoke all sessions. Clearing this browser's cookie alone leaves other
// copies valid.
export async function signOut() {
  const { userId } = await getSession();
  if (userId) {
    await revokeAllSessions(userId);
  }
  await destroySession();
  redirect('/login');
}

// A real scrypt hash of a random string, used only to spend the same CPU time
// on a missing account as on a real one. Its plaintext is unknown and unused.
const dummyHash =
  'scrypt$65536$8$1$CftBGH0+i21Hii5EPwDwQg==$CsAkgiwdSpCsLUVtHuOVbTMKVzfOfRfzRHrH+962fr+pEP6ZSr0n2BNFkhPBOxBMn8m8o/Bd2imihYsJE2m9Ng==';
