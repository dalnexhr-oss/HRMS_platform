import { redirect } from 'next/navigation';
import { todayIST } from '@/lib/display-formatting';
import { getSession } from '@/lib/server-auth';
import { createClient } from '@/lib/db/server-client';
import { LeaveHistory } from '@/components/leave-management/LeaveHistory';
import { getOnLeaveToday, getRequests } from '@/lib/server-queries';
import type { AppRole } from '@/types/database';

// Fetch live leave queues on each request.
export const dynamic = 'force-dynamic';

// Match the leave-management navigation role gate.
const hrRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// Active-roster headcount; null when it cannot be counted (shown as —).
async function getHeadcount(): Promise<number | null> {
  try {
    const dbc = await createClient();
    const { count, error } = await dbc
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active', 'on_notice']);
    return error ? null : (count ?? null);
  } catch {
    return null;
  }
}

async function HrDashboardPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !hrRoles.includes(role)) {
    redirect('/dashboard');
  }

  const [requests, onLeaveToday, headcount] = await Promise.all([
    getRequests(),
    getOnLeaveToday().catch(() => []),
    getHeadcount(),
  ]);

  // The Leave Management tab tracks LEAVE requests; duty/WFH/comp-off requests
  // stay on /approvals and the register.
  const leaves = requests.filter((r) => r.type === 'leave');
  const pendingLeaves = leaves.filter((r) => r.status === 'pending').length;
  const thisMonth = todayIST().slice(0, 7);
  const approvedThisMonth = leaves.filter(
    (r) => r.status === 'approved' && r.reviewedAt?.slice(0, 7) === thisMonth,
  ).length;

  return (
    <div className="content-container grid">
      {/* workforce-at-a-glance KPI band */}
      <div className="summary-cards">
        <div className="card summary-card">
          <div className="metric-label">Active employees</div>
          <div className="metric-value">{headcount ?? '—'}</div>
          <div className="metric-note">on the roster today</div>
        </div>
        <div className="card summary-card">
          <div className="metric-label">On leave today</div>
          <div className="metric-value" style={{ color: onLeaveToday.length ? 'var(--attendance-late)' : 'var(--attendance-present)' }}>
            {onLeaveToday.length}
          </div>
          <div className="metric-note">
            {onLeaveToday.length
              ? onLeaveToday
                  .slice(0, 3)
                  .map((p) => p.name.split(' ')[0])
                  .join(', ') + (onLeaveToday.length > 3 ? '…' : '')
              : 'everyone is in'}
          </div>
        </div>
        <div className="card summary-card">
          <div className="metric-label">Leave requests pending</div>
          <div className="metric-value" style={{ color: pendingLeaves ? 'var(--attendance-late)' : 'var(--attendance-present)' }}>
            {pendingLeaves}
          </div>
          <div className="metric-note">decided on the Approvals page</div>
        </div>
        <div className="card summary-card">
          <div className="metric-label">Leaves approved</div>
          <div className="metric-value" style={{ color: 'var(--attendance-present)' }}>
            {approvedThisMonth}
          </div>
          <div className="metric-note">this month</div>
        </div>
      </div>

      {/* the Leave Management tab — complete request history */}
      <LeaveHistory requests={leaves} />

      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        Every leave request an employee submits lands in <b>Approvals</b> for a decision and is
        tracked here from submission to its final outcome. Balances and the annual leave-salary
        working live on the <b>Leave salary</b> page; day-to-day attendance on the{' '}
        <b>Monthly register</b>.
      </p>
    </div>
  );
}

export { HrDashboardPage as default };
