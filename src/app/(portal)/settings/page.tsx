import { redirect } from 'next/navigation';
import { getSettings, getBranches } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

// Match the settings actions and navigation role gate.
export default async function SettingsPage() {
  const { profile } = await getSession();
  const role = (profile?.role ?? '').toLowerCase();
  if (role !== 'admin' && role !== 'hr' && role !== 'super_admin') redirect('/today');

  const [settings, branches] = await Promise.all([getSettings(), getBranches()]);
  return <SettingsScreen settings={settings} branches={branches} />;
}
