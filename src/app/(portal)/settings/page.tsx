import { getSettings, getBranches } from '@/lib/queries';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

export default async function SettingsPage() {
  const [settings, branches] = await Promise.all([getSettings(), getBranches()]);
  return <SettingsScreen settings={settings} branches={branches} />;
}
