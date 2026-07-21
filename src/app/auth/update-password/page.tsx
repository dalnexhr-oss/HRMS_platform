import type { Metadata } from 'next';
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';
import { Brand } from '@/components/ui/Brand';

export const metadata: Metadata = { title: 'Set a new password — Dalnex HRMS' };

export default function UpdatePasswordPage() {
  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <Brand priority />
          <p className="muted">Choose a new password for your account.</p>
        </div>

        <UpdatePasswordForm />
      </div>
    </div>
  );
}
