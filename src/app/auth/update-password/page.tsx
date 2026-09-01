import type { Metadata } from 'next';
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';
import { Brand } from '@/components/ui/Brand';

export const metadata: Metadata = { title: 'Set a new password — Dalnex HRMS' };

// The token arrives in the reset link's query string. It is read here and
// handed to the form as a hidden field rather than being touched by client
// JavaScript, so it never lands in a client-side router cache.
export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <Brand priority />
          <p className="muted">Choose a new password for your account.</p>
        </div>

        <UpdatePasswordForm token={value} />
      </div>
    </div>
  );
}
