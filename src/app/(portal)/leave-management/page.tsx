import './leave-management.css';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { LeaveScreen } from '@/components/leave-management/LeaveScreen';
import { getRosterHeadcount } from '@/lib/queries/employees';
import { getOnLeaveToday } from '@/lib/queries/leave';
import { getRequests } from '@/lib/queries/requests';
import type { AppRole } from '@/types/database';

// Fetch live leave queues on each request.
export const dynamic = 'force-dynamic';

// Match the leave-management navigation role gate.
const hrRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function LeavePage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !hrRoles.includes(role)) {
    redirect('/dashboard');
  }

  const [requests, onLeaveToday, headcount] = await Promise.all([
    getRequests(),
    getOnLeaveToday().catch(() => []),
    getRosterHeadcount(),
  ]);

  return <LeaveScreen requests={requests} onLeaveToday={onLeaveToday} headcount={headcount} />;
}

export { LeavePage as default };
