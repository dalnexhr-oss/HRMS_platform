'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signIn, type SignInState } from '@/lib/actions/auth';

// NOTE: self-service OAuth was removed deliberately. This is an internal portal
// whose accounts are provisioned by HR, so open OAuth (any account → an
// auto-created profile) was an authorization hole: it let anyone sign in and
// reach the portal. Accounts are created by an admin (npm run db:setup -- --admin,
// or the Users tab). If federated login is ever wanted, gate the provider to an
// allowed email domain before reinstating a button here.
export function LoginForm({
  initialError,
  next,
}: { initialError?: string; next?: string } = {}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  // Errors from the sign-in action win, then anything middleware redirected
  // back with.
  const error = state.error ?? initialError ?? null;

  return (
    <form action={action} className="login-form">
      {/* Where middleware wanted to send them before the login gate stepped in.
          signIn() only honours relative paths, so this cannot become an open
          redirect. */}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="f">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" placeholder="your_name@dalnex.com" autoComplete="email" required />
      </div>
      <div className="f">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <button className="btn primary" type="submit" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Link href="/auth/reset" style={{ fontSize: 13, color: 'var(--brand)' }}>
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}
