import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { Brand } from '@/components/ui/Brand';

export const metadata: Metadata = { title: 'Sign in — Dalnex HRMS' };

// /auth/callback and the middleware redirect back here with ?error=... when
// sign-in fails, so the real reason is shown instead of a blank login card.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const initialError = Array.isArray(error) ? error[0] : error;

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <Brand priority />
          <p className="muted">Sign in to your admin or employee account.</p>
        </div>

        <LoginForm initialError={initialError} />

        <div className="login-demo">
        </div>
      </div>
    </div>
  );
}
