import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { AvatarMenu } from '@/components/shell/AvatarMenu';
import type { SessionContext } from '@/lib/server-auth';

function AccountScreen({ profile, email }: Pick<SessionContext, 'profile' | 'email'>) {
  return (
    <div className="content-container grid account-page">
      <div className="card">
        <div className="card-header">
          <h3>My account</h3>
          <span className="card-caption">{profile?.role ?? 'signed in'}</span>
        </div>
        <div className="card-body">
          <div className="account-profile">
            <AvatarMenu name={profile?.full_name} avatar={profile?.avatar} align="left" />
            <div>
              <div className="account-name">{profile?.full_name ?? '—'}</div>
              <div className="text-muted account-hint">
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

export { AccountScreen };
