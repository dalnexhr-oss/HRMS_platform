import { redirect } from 'next/navigation';
import { getSession, isStaffRole } from '@/lib/auth';
import { canAccessTab } from '@/lib/access';
import { getMyTabAccess } from '@/lib/queries';
import { readBoard } from '@/lib/tv';
import { EmployeeScreen } from '@/components/tv-dashboard/EmployeeScreen';

export const dynamic = 'force-dynamic';

// Seed the board on the server, then poll for updates. This route sits outside the portal layout,
// so it must enforce tab access itself.
export default async function TvPage() {
  const { profile } = await getSession();
  if (!isStaffRole(profile?.role)) {
    redirect('/login?error=The+attendance+board+is+available+to+staff+accounts+only.');
  }

  const access = await getMyTabAccess(profile?.id ?? null);
  if (!canAccessTab(profile?.role, 'tv', access)) {
    redirect('/today');
  }

  const board = await readBoard();
  return <EmployeeScreen initial={board} />;
}
