import type { Metadata } from 'next';
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';

export const metadata: Metadata = { title: 'Set a new password — Dalnex HRMS' };

export default function UpdatePasswordPage() {
  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <div className="eyebrow">HRMS · Muster</div>
          <h1>
            Dalnex<span>.</span>
          </h1>
          <p className="muted">Choose a new password for your account.</p>
        </div>

        <UpdatePasswordForm />
      </div>
    </div>
  );
}
