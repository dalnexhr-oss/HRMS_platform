'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { signIn } from '@/lib/actions/auth';
import type { SignInState } from '@/lib/actions/auth';

// Accounts are provisioned by HR through Users or db:setup. Any future federated login must
// restrict access to approved accounts.
export function LoginForm({ initialError, next }: { initialError?: string; next?: string } = {}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const [showPassword, setShowPassword] = useState(false);

  // Errors from the sign-in action win, then anything middleware redirected
  // back with.
  const error = state.error ?? initialError ?? null;

  return (
    <form action={action} className="login-form">
      {/* Where middleware wanted to send them before the login gate stepped in. signIn() only honours relative paths, so this cannot become an open redirect. */}
      {next && <input type="hidden" name="next" value={next} />}
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
      <div className="f">
        <label htmlFor="password">Password</label>
        <div className="login-password">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="login-password-toggle"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-controls="password"
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword && <path d="m3 3 18 18" />}
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="login-error" role="alert">
          {error}
        </div>
      )}

      <button
        className="btn primary"
        type="submit"
        disabled={pending}
        style={{ width: '100%', justifyContent: 'center' }}
      >
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
