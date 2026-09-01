'use client';

// Set a new password from a reset link.
//
// The token comes from the link's ?token= and rides along as a hidden field.
// Redeeming it does NOT sign the user in — they type the new password once on
// the login page, which proves it was stored as intended and catches a
// password-manager mismatch immediately rather than at the next sign-in.
import { useActionState } from 'react';
import Link from 'next/link';
import { resetPassword, type PasswordState } from '@/lib/actions/password';

/** Mirrors validatePassword() in lib/auth/password.ts. */
const MIN_LEN = 10;

export function UpdatePasswordForm({ token }: { token?: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(resetPassword, {});

  // A link with no token cannot be completed, so say so before they type a
  // password and lose it to a failed submit.
  if (!token) {
    return (
      <div>
        <div className="login-error" role="alert">
          This reset link is incomplete. Request a new one.
        </div>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <Link href="/auth/reset" style={{ fontSize: 13, color: 'var(--brand)' }}>
            Send a new reset link
          </Link>
        </div>
      </div>
    );
  }

  if (state.done) {
    return (
      <div>
        <div className="hint">
          ✓&nbsp; Your password has been updated, and every other device has been signed out.
        </div>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <Link className="btn primary" href="/login" style={{ width: '100%', justifyContent: 'center' }}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="token" value={token} />

      <div className="f">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LEN}
          required
        />
        <span className="hint">At least {MIN_LEN} characters.</span>
      </div>
      <div className="f">
        <label htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LEN}
          required
        />
      </div>

      {state.error && (
        <div className="login-error" role="alert">
          {state.error}
        </div>
      )}

      <button
        className="btn primary"
        type="submit"
        disabled={pending}
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
