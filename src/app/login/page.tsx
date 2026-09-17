import { LoginForm } from '@/components/auth/LoginForm';
import { Brand } from '@/components/ui/Brand';
import { safeRedirectPath } from '@/lib/auth/redirect';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in — Dalnex HRMS' };

// Show sign-in errors from middleware or password reset. The next parameter preserves the requested
// destination.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  const initialError = Array.isArray(error) ? error[0] : error;
  // Validate next before placing it in the form. signIn validates it again at the action boundary.
  const nextPath = safeRedirectPath(Array.isArray(next) ? next[0] : next) ?? undefined;

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <Brand priority />
          <p className="muted">Sign in to your staff or employee account.</p>
        </div>

        <LoginForm initialError={initialError} next={nextPath} />
      </div>
    </div>
  );
}
