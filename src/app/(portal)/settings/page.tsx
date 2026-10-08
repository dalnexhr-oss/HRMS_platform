import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/queries/settings';
import { documentSettingKeys } from '@/lib/queries/document-settings';
import { getBranches } from '@/lib/queries/branches';
import { getSession } from '@/lib/server-auth';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import './settings.css';

// Match the settings actions and navigation role gate.
async function SettingsPage() {
  const { profile } = await getSession();
  const role = (profile?.role ?? '').toLowerCase();
  if (role !== 'admin' && role !== 'hr' && role !== 'super_admin') {
    redirect('/dashboard');
  }

  const [settings, branches] = await Promise.all([getSettings(), getBranches()]);
  return (
    <SettingsScreen
      // Document types and letter wording have their own editors on the Documents tab.
      settings={settings.filter((setting) => !documentSettingKeys.includes(setting.key))}
      branches={branches}
    />
  );
}

export { SettingsPage as default };
