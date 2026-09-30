import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { AssetsScreen } from '@/components/assets/AssetsScreen';
import { getAssets, getAssetSummary } from '@/lib/queries/assets';
import { getEmployeeOptions } from '@/lib/queries/employees';
import type { AppRole } from '@/types/database';

// Asset Management is accessible to super_admin/admin/HR .
const assetAdminRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function AssetsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !assetAdminRoles.includes(role)) {
    redirect('/dashboard');
  }

  const [assets, employees, summary] = await Promise.all([
    getAssets(),
    getEmployeeOptions(),
    getAssetSummary(),
  ]);
  return <AssetsScreen assets={assets} employees={employees} summary={summary} />;
}

export { AssetsPage as default };
