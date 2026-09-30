import Link from 'next/link';
import { getSession } from '@/lib/server-auth';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { AvatarMenu } from '@/components/shell/AvatarMenu';

// Employee account settings. Staff use /account.
async function EmployeeAccountPage() {
  const { profile, email } = await getSession();

  return (
    <div className="content-container grid">
      <div>
        <Link href="/employee" className="button quiet">
          ← Back to dashboard
        </Link>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>My account</h3>
          <span className="card-caption">{profile?.role ?? 'signed in'}</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <AvatarMenu name={profile?.full_name} avatar={profile?.avatar} align="left" />
            <div>
              <div style={{ fontWeight: 600 }}>{profile?.full_name ?? '—'}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Click your picture to upload a photo or pick an avatar.
              </div>
            </div>
          </div>
          <div className="label-value-row">
            <span>Name</span>
            <span className="label-value">{profile?.full_name ?? '—'}</span>
          </div>
          <div className="label-value-row">
            <span>Email</span>
            <span className="label-value text-monospace">{email ?? '—'}</span>
          </div>
          <div className="label-value-row">
            <span>Role</span>
            <span className="label-value">{profile?.role ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Change password</h3>
        </div>
        <div className="card-body">
          <ChangePasswordForm email={email} />
        </div>
      </div>
    </div>
  );
}

export { EmployeeAccountPage as default };
