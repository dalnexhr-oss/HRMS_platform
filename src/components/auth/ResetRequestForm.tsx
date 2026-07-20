'use client';

// Request a password-reset email. Uses the browser Supabase client (anon key):
// resetPasswordForEmail sends a recovery link back to /auth/callback, which
// establishes a session and forwards to /auth/update-password.
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export function ResetRequestForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured, so password reset is unavailable.');
      return;
    }
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (error) {
        setError(error.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email.');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div>
        <div className="hint">
          ✓&nbsp; If an account exists for <b>{email}</b>, a password-reset link is on its way.
          Check your inbox and follow the link to set a new password.
        </div>
        <div style={{ marginTop: 14 }}>
          <Link href="/login" style={{ fontSize: 13, color: 'var(--brand)' }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="login-form">
      <div className="f">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@dalnex.test"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
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
