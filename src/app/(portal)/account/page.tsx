import { getSession } from '@/lib/auth';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { AvatarMenu } from '@/components/shell/AvatarMenu';

// Personal account settings for staff. (/settings holds the company-wide rules;
// this is the signed-in user's own account.) Employees get the same card on /me.
export default async function AccountPage() {
  const { profile, email, demo } = await getSession();

  return (
    <div className="wrap grid">
      <div className="card">
        <div className="hd">
          <h3>My account</h3>
          <span className="folio">{profile?.role ?? 'signed in'}</span>
        </div>
        <div className="bd">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <AvatarMenu name={profile?.full_name} avatar={profile?.avatar} align="left" />
            <div>
              <div style={{ fontWeight: 600 }}>{profile?.full_name ?? '—'}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Click your picture to upload a photo or pick an avatar.
              </div>
            </div>
          </div>
          <div className="kv">
            <span>Name</span>
            <span className="v">{profile?.full_name ?? '—'}</span>
          </div>
          <div className="kv">
            <span>Email</span>
            <span className="v mono">{email ?? '—'}</span>
          </div>
          <div className="kv">
            <span>Role</span>
            <span className="v">{profile?.role ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h3>Change password</h3>
        </div>
        <div className="bd">
          {demo ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Demo mode — there is no real account to change a password for.
            </p>
          ) : (
            <ChangePasswordForm email={email} />
          )}
        </div>
      </div>
    </div>
  );
}
