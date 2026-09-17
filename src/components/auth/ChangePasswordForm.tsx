'use client';

// Verify the current password server-side before changing it. Checking the stored hash avoids
// replacing the active session.
import { useActionState } from 'react';
import { changePassword } from '@/lib/actions/password';
import type { PasswordState } from '@/lib/actions/password';

// Mirrors validatePassword() in lib/auth/password.ts.
const minLen = 10;

export function ChangePasswordForm({ email }: { email?: string | null }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});

  return (
    <form action={action}>
      {/* The server identifies the account from the session cookie, never from a field the browser could change. Kept as a prop so the account pages can go on labelling the form with the address. */}
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
            minLength={minLen}
            required
          />
          <span className="hint">At least {minLen} characters.</span>
        </div>
        <div className="f">
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={minLen}
            required
          />
        </div>
      </div>

      {state.error && (
        <div className="login-error" role="alert">
          {state.error}
        </div>
      )}
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
