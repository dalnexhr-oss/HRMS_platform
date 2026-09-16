import { redirect } from 'next/navigation';
import { ItemsScreen } from '@/components/items/ItemsScreen';
import { getItems, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Match the item actions and navigation role gate.
const itemAdminRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function ItemsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !itemAdminRoles.includes(role)) redirect('/today');

  const [items, employees] = await Promise.all([getItems(), getEmployeeOptions()]);
  return <ItemsScreen items={items} employees={employees} />;
}
