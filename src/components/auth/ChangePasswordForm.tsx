'use client';

// Change your own password while signed in.
//
// Supabase's updateUser({password}) does NOT verify the current password — an
// unattended session could otherwise be used to lock the real owner out. So the
// current password is checked first by re-authenticating with it; only then is
// the new one set.
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/env';

const MIN_LEN = 8;

export function ChangePasswordForm({ email }: { email: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured, so passwords cannot be changed.');
      return;
    }
    if (!email) {
      setError('Your account has no email address, so the current password cannot be verified.');
      return;
    }
    if (next.length < MIN_LEN) {
      setError(`The new password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    if (next === current) {
      setError('The new password must be different from the current one.');
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();

      // 1. Prove they know the current password.
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (authError) {
        setError('Your current password is not correct.');
        return;
      }

      // 2. Set the new one.
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="f">
        <label htmlFor="cp-current">Current password</label>
        <input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="f-row">
        <div className="f">
          <label htmlFor="cp-next">New password</label>
          <input
            id="cp-next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <div className="f">
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {done && <div className="hint">✓&nbsp; Your password has been changed.</div>}

      <button className="btn primary" type="submit" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
