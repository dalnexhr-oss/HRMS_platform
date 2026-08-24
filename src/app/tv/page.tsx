import { redirect } from 'next/navigation';
import { getSession, isStaffRole } from '@/lib/auth';
import { canAccessTab } from '@/lib/access';
import { getMyTabAccess } from '@/lib/queries';
import { readBoard } from '@/lib/tv';
import { EmployeeScreen } from '@/components/TvDashboard/EmployeeScreen';

export const dynamic = 'force-dynamic';

/**
 * The board is server-rendered once so the wall screen shows real data the
 * instant it loads, then the client polls to keep it live. A TV is often left
 * on a signed-in session for weeks, so it is gated like the portal.
 *
 * The tab-access check is repeated HERE rather than inherited. /tv deliberately
 * lives outside the (portal) route group so it can drop the sidebar and topbar
 * — which also means the layout that normally enforces canAccessTab() never
 * runs for it. Without this, revoking "TV board" on /users would hide the link
 * and change nothing about who can open the URL.
 */
export default async function TvPage() {
  const { profile } = await getSession();
  if (!isStaffRole(profile?.role)) {
    redirect('/login?error=The+attendance+board+is+available+to+staff+accounts+only.');
  }

  const access = await getMyTabAccess(profile?.id ?? null);
  if (!canAccessTab(profile?.role, 'tv', access)) redirect('/today');

  const board = await readBoard();
  return <EmployeeScreen initial={board} />;
}
