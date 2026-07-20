import { getSettings } from '@/lib/queries';
import { SettingsScreen } from '@/components/settings/SettingsScreen';

export default async function SettingsPage() {
  const settings = await getSettings();
  return <SettingsScreen settings={settings} />;
}
