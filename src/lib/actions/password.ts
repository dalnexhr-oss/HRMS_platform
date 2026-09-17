'use server';

// Server Actions for password reset requests, token consumption, and password updates.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, createSession, destroySession, revokeAllSessions } from '@/lib/auth/session';
import { hashPassword, validatePassword, verifyPassword } from '@/lib/auth/password';
import { consumeResetToken, createResetToken, resetTokenTtlMinutes } from '@/lib/auth/reset-tokens';
import { usersCollection } from '@/lib/db/collections';
import { isMongoConfigured } from '@/lib/db/mongo';
import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email';
import { appOrigin, originNotConfigured } from '@/lib/auth/origin';

export interface PasswordState {
  error?: string;
  sent?: boolean;
  done?: boolean;
  // Dev-only: the reset link, when there is no SMTP server to send it.
  devLink?: string;
}

// Request a reset link

// Initiates password reset flow. Returns uniform success response to prevent account enumeration.
export async function requestPasswordReset(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email) {
    return { error: 'Enter your email.' };
  }
  if (!isMongoConfigured()) {
    return { error: 'The database is not configured, so password reset is unavailable.' };
  }

  // Both of these are properties of the DEPLOYMENT, not of the address, so they
  // are resolved first — and no token is minted for a link that could not have
  // been built or sent.
  const origin = await appOrigin();
  if (!origin) {
    return { error: originNotConfigured };
  }

  const emailConfigured = isEmailConfigured();
  if (!emailConfigured && process.env.NODE_ENV === 'production') {
    return { error: 'Email is not configured, so the reset link could not be sent.' };
  }

  const users = await usersCollection();
  const user = await users.findOne({ email }, { collation: { locale: 'en', strength: 2 } });

  // A disabled account gets the same silent treatment as a missing one.
  if (!user || user.disabled) {
    return { sent: true };
  }

  const h = await headers();
  const token = await createResetToken(
    user._id,
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  );
  const link = `${origin}/auth/update-password?token=${encodeURIComponent(token)}`;

  if (!emailConfigured) {
    // Development affordance: with no SMTP server there is no way to receive
    // the link, and a reset flow that cannot be tested locally does not get
    // tested. Unreachable in production — refused above, before the lookup.
    console.warn(`[auth] SMTP not configured — reset link for ${email}:\n${link}`);
    return { sent: true, devLink: link };
  }

  // full_name is set by whoever created the account, so it is escaped before it
  // reaches the HTML body. The text part needs no escaping and gets none.
  const greeting = user.full_name ?? '';
  await sendEmail({
    to: user.email,
    subject: 'Reset your Dalnex HRMS password',
    text:
      `Hello ${greeting},\n\n` +
      `Open this link to choose a new password. It expires in ${resetTokenTtlMinutes} minutes ` +
      `and can be used once:\n\n${link}\n\n` +
      `If you did not ask for this, you can ignore this email — your password has not changed.\n`,
    html:
      `<p>Hello ${escapeHtml(greeting)},</p>` +
      `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>` +
      `<p>The link expires in ${resetTokenTtlMinutes} minutes and can be used once.</p>` +
      `<p>If you did not ask for this, you can ignore this email — your password has not changed.</p>`,
  });

  return { sent: true };
}

// Redeem a reset link

export async function resetPassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!token) {
    return { error: 'That reset link is missing its token. Request a new one.' };
  }
  if (password !== confirm) {
    return { error: 'The two passwords do not match.' };
  }

  const invalid = validatePassword(password);
  if (invalid) {
    return { error: invalid };
  }

  const claim = await consumeResetToken(token);
  if (!claim) {
    return { error: 'That reset link has expired or has already been used. Request a new one.' };
  }

  const passwordHash = await hashPassword(password);
  const users = await usersCollection();
  const result = await users.findOneAndUpdate(
    { _id: claim.userId, token_version: claim.tokenVersion, disabled: false },
    {
      $set: { password_hash: passwordHash, updated_at: new Date() },
      // Every other session this account holds dies here. A password reset is
      // the standard response to "someone else is in my account", so leaving
      // their existing year-long cookies alive would defeat the point.
      $inc: { token_version: 1 },
    },
    { returnDocument: 'after' },
  );

  if (!result) {
    return { error: 'That reset link is no longer valid. Request a new one.' };
  }

  // Require a fresh sign-in with the new password after resetting it.
  await destroySession();
  return { done: true };
}

// Change your own password while signed in

export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const current = String(formData.get('current') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const { userId } = await getSession();
  if (!userId) {
    redirect('/login');
  }

  if (password !== confirm) {
    return { error: 'The two passwords do not match.' };
  }
  const invalid = validatePassword(password);
  if (invalid) {
    return { error: invalid };
  }

  const users = await usersCollection();
  const user = await users.findOne({ _id: userId });
  if (!user) {
    return { error: 'That account no longer exists.' };
  }

  // Proving the current password is what stops a borrowed unlocked laptop from
  // becoming a permanent account takeover.
  if (!(await verifyPassword(current, user.password_hash))) {
    return { error: 'Your current password is not correct.' };
  }

  const updated = await users.findOneAndUpdate(
    {
      _id: userId,
      password_hash: user.password_hash,
      token_version: user.token_version,
      disabled: false,
    },
    {
      $set: { password_hash: await hashPassword(password), updated_at: new Date() },
      $inc: { token_version: 1 },
    },
    { returnDocument: 'after' },
  );

  if (!updated) {
    return { error: 'Your account changed while saving. Sign in again and retry.' };
  }

  // The bump above just invalidated this browser's cookie too. Re-issue it so
  // the person who made the change stays signed in while every other device is
  // signed out — which is what "change my password" is expected to do.
  await createSession(updated);

  return { done: true };
}

/** Sign every device out of an account. Used by the account page. */
export async function signOutEverywhere(): Promise<void> {
  const { userId } = await getSession();
  if (userId) {
    await revokeAllSessions(userId);
  }
  await destroySession();
  redirect('/login');
}
