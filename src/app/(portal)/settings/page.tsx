import { redirect } from 'next/navigation';
import { getSettings, getBranches } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

// Settings is admin-only — the same gate as its sidebar entry (NAV_ROLE_GATED)
// and its actions (updateSetting/updateBranch/deleteBranch). Anyone else is
// bounced rather than shown a screen whose every control would be refused.
export default async function SettingsPage() {
  const { profile } = await getSession();
  const role = (profile?.role ?? '').toLowerCase();
  if (role !== 'admin' && role !== 'hr') redirect('/today');

  const [settings, branches] = await Promise.all([getSettings(), getBranches()]);
  return <SettingsScreen settings={settings} branches={branches} />;
}
