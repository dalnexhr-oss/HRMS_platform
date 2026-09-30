import '@/components/auth/auth.css';
import { ResetRequestForm } from '@/components/auth/ResetRequestForm';
import { Brand } from '@/components/ui/Brand';
import type { Metadata } from 'next';

const metadata: Metadata = { title: 'Reset password — Dalnex HRMS' };

function ResetPage() {
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

export { metadata };
export { ResetPage as default };
