import type { Metadata } from 'next';
import { ResetRequestForm } from '@/components/auth/ResetRequestForm';
import { Brand } from '@/components/ui/Brand';

export const metadata: Metadata = { title: 'Reset password — Dalnex HRMS' };

export default function ResetPage() {
  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <Brand priority />
          <p className="muted">Enter your email and we’ll send a reset link.</p>
        </div>

        <ResetRequestForm />
      </div>
    </div>
  );
}
