import type { Metadata } from 'next';
import { ResetRequestForm } from '@/components/auth/ResetRequestForm';

export const metadata: Metadata = { title: 'Reset password — Dalnex HRMS' };

export default function ResetPage() {
  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <div className="eyebrow">HRMS · Muster</div>
          <h1>
            Dalnex<span>.</span>
          </h1>
          <p className="muted">Enter your email and we’ll send a reset link.</p>
        </div>

        <ResetRequestForm />
      </div>
    </div>
  );
}
