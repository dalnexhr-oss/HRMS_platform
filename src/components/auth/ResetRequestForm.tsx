'use client';

// Request a password-reset email.
//
// The response is deliberately identical whether or not the address exists —
// see requestPasswordReset() for why. That means this component never shows a
// "no such account" state, because the server never reports one.
import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordReset, type PasswordState } from '@/lib/actions/password';

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(
    requestPasswordReset,
    {},
  );

  if (state.sent) {
    return (
      <div>
        <div className="hint">
          ✓&nbsp; If an account exists for that address, a password-reset link is on its
          way. It expires in an hour and can be used once.
        </div>

        {/* Only ever set in development, when there is no SMTP server to send
            through and the link would otherwise be unreachable. */}
        {state.devLink && (
          <div className="hint" style={{ marginTop: 10, wordBreak: 'break-all' }}>
            <b>Development:</b> email is not configured, so the link is shown here.
            <br />
            <a href={state.devLink}>{state.devLink}</a>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Link href="/login" style={{ fontSize: 13, color: 'var(--brand)' }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="login-form">
      <div className="f">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="your_name@dalnex.com"
          autoComplete="email"
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
        {pending ? 'Sending…' : 'Send reset link'}
      </button>

      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Link href="/login" style={{ fontSize: 13, color: 'var(--brand)' }}>
          ← Back to sign in
        </Link>
      </div>
    </form>
  );
}
