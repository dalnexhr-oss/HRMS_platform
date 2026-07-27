import { redirect } from 'next/navigation';
import { AssetsScreen } from '@/components/assets/AssetsScreen';
import { getAssets, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Asset Management is admin/HR only. Anyone else is bounced (the nav link is also
// hidden for them via NAV_ROLE_GATED).
const ASSET_ADMIN_ROLES: AppRole[] = ['admin', 'hr'];

export default async function AssetsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !ASSET_ADMIN_ROLES.includes(role)) redirect('/today');

  const [assets, employees] = await Promise.all([getAssets(), getEmployeeOptions()]);
  return <AssetsScreen assets={assets} employees={employees} />;
}
