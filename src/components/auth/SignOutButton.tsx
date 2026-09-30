'use client';

import { signOut } from '@/lib/actions/auth';

function SignOutButton({ label = 'Sign out' }: { label?: string }) {
  return (
    <form action={signOut}>
      <button className="button quiet" type="submit">
        {label}
      </button>
    </form>
  );
}

export { SignOutButton };
