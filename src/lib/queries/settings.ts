import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { defaultWeekOffPolicy, policyFromSettings } from '@/lib/weekly-off-policy';
import { fail } from '@/lib/queries/shared';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import type { WeekOffPolicy } from '@/lib/weekly-off-policy';
import type { TabAccess } from '@/lib/portal-access';
import type { UserDoc } from '@/lib/db/collection-registry';

// week-off policy
/**
 * Read the configured week-off schedule. Missing or unreadable settings default to Sundays and
 * Saturdays other than the second and fourth.
 */
async function getWeekOffPolicy(): Promise<WeekOffPolicy> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('settings')
    .select('key, value')
    .in('key', ['week_off_weekdays', 'working_saturdays']);
  if (error || !data) {
    return defaultWeekOffPolicy;
  }

  const byKey = new Map(data.map((r: any) => [r.key, r.value]));
  return policyFromSettings(byKey.get('week_off_weekdays'), byKey.get('working_saturdays'));
}

// settings
interface SettingView {
  key: string;
  value: unknown;
  label: string | null;
  description: string | null;
}

async function getSettings(): Promise<SettingView[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('settings')
    .select('key, value, label, description')
    .order('key');
  if (error) {
    fail('getSettings: could not load settings', error);
  }
  return (data ?? []).map((s: any) => ({
    key: s.key,
    value: s.value,
    label: s.label,
    description: s.description,
  }));
}

// user tab access
/**
 * Read the signed-in account's tab-access map. Missing entries mean allowed within the static role
 * gate; a missing map behaves as an empty map.
 */
async function getMyTabAccess(userId: string | null): Promise<TabAccess> {
  if (!userId) {
    return {};
  }
  // Read tab-access overrides from the session's user document to avoid a separate query on every
  // portal request.
  const users = await scoped<UserDoc>(collections.users);
  const user = await users.findOne({ _id: userId }, { projection: { tab_access: 1 } });
  return (user?.tab_access as TabAccess) ?? {};
}

export { getWeekOffPolicy, getSettings, getMyTabAccess };

export type { SettingView };
