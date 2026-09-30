import { redirect } from 'next/navigation';
import { getSession, isStaffRole } from '@/lib/server-auth';
import { canAccessTab } from '@/lib/portal-access';
import { getMyTabAccess } from '@/lib/queries/settings';
import { readBoard } from '@/lib/tv-dashboard-data';
import { EmployeeScreen } from '@/components/tv-dashboard/EmployeeScreen';

export const dynamic = 'force-dynamic';

// Seed the board on the server, then poll for updates. This route sits outside the portal layout,
// so it must enforce tab access itself.
async function TvPage() {
  const { profile } = await getSession();
  if (!isStaffRole(profile?.role)) {
    redirect('/login?error=The+TV+dashboard+is+available+to+staff+accounts+only.');
  }

  const access = await getMyTabAccess(profile?.id ?? null);
  if (!canAccessTab(profile?.role, 'tv-dashboard', access)) {
    redirect('/dashboard');
  }

  const board = await readBoard();
  return <EmployeeScreen initial={board} />;
}

export { TvPage as default };
