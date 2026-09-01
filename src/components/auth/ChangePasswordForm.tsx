'use client';

// Change your own password while signed in.
//
// The current password is verified server-side against the stored hash before
// the new one is written — an unattended session must not be enough to lock the
// real owner out.
//
// This used to prove the current password by calling signInWithPassword with
// it, which REPLACED the live session as a side effect. Verifying the hash
// directly has no such effect, and never puts the password on the wire twice.
import { useActionState } from 'react';
import { changePassword, type PasswordState } from '@/lib/actions/password';

/** Mirrors validatePassword() in lib/auth/password.ts. */
const MIN_LEN = 10;

export function ChangePasswordForm({ email }: { email?: string | null }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});

  return (
    <form action={action}>
      {/* Not sent anywhere: the server identifies the account from the session
          cookie, never from a field the browser could change. Kept as a prop so
          the account pages can go on labelling the form with the address. */}
      {email && (
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as {email}.
        </p>
      )}

      <div className="f">
        <label htmlFor="cp-current">Current password</label>
        <input
          id="cp-current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="f-row">
        <div className="f">
          <label htmlFor="cp-next">New password</label>
          <input
            id="cp-next"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_LEN}
            required
          />
          <span className="hint">At least {MIN_LEN} characters.</span>
        </div>
        <div className="f">
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={MIN_LEN}
            required
          />
        </div>
      </div>

      {state.error && <div className="login-error" role="alert">{state.error}</div>}
      {state.done && (
        <div className="hint">
          ✓&nbsp; Your password has been changed, and every other device has been signed out.
        </div>
      )}

      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
