import './account.css';
import { getSession } from '@/lib/server-auth';
import { AccountScreen } from '@/components/account/AccountScreen';

// Personal staff settings; company settings live at /settings.
async function AccountPage() {
  const { profile, email } = await getSession();
  return <AccountScreen profile={profile} email={email} />;
}

export { AccountPage as default };
