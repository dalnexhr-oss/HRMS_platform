import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { Brand } from '@/components/ui/Brand';
import { safeRedirectPath } from '@/lib/auth/redirect';

export const metadata: Metadata = { title: 'Sign in — Dalnex HRMS' };

// Middleware and the reset flow redirect back here with ?error=... when sign-in
// fails, so the real reason is shown instead of a blank login card. ?next= is
// the path the visitor was trying to reach before the gate stepped in.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  const initialError = Array.isArray(error) ? error[0] : error;
  // Validated HERE as well as in signIn(). The action is the security boundary
  // — it is a public endpoint and re-checks whatever it is posted — but a
  // hostile ?next= should never be rendered into the form in the first place,
  // where it would sit in the DOM of a page on the real domain.
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
