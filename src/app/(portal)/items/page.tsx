import { redirect } from 'next/navigation';
import { ItemsScreen } from '@/components/items/ItemsScreen';
import { getItems, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Item Management is admin/HR only. Anyone else is bounced (the nav link is also
// hidden for them via NAV_ROLE_GATED).
const ITEM_ADMIN_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function ItemsPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !ITEM_ADMIN_ROLES.includes(role)) redirect('/today');

  const [items, employees] = await Promise.all([getItems(), getEmployeeOptions()]);
  return <ItemsScreen items={items} employees={employees} />;
}
