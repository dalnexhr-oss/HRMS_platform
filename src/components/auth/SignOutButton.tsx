'use client';

import { signOut } from '@/lib/actions/auth';

export function SignOutButton({ label = 'Sign out' }: { label?: string }) {
  return (
    <form action={signOut}>
      <button className="btn quiet" type="submit">
        {label}
      </button>
    </form>
  );
}
