import { redirect } from 'next/navigation';
import { LeaveHistory } from '@/components/Leave_Management/LeaveHistory';
import { getOnLeaveToday, getRequests } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// The HR dashboard aggregates live queues — never prerender a stale one.
export const dynamic = 'force-dynamic';

// HR management is admin/HR only, mirroring NAV_ROLE_GATED.hr.
const HR_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

/** Active-roster headcount; null when it cannot be counted (shown as —). */
async function getHeadcount(): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active', 'on_notice']);
    return error ? null : count;
  } catch {
    return null;
  }
}

export default async function HrDashboardPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !HR_ROLES.includes(role)) redirect('/today');

  const [requests, onLeaveToday, headcount] = await Promise.all([
    getRequests(),
    getOnLeaveToday().catch(() => []),
    getHeadcount(),
  ]);

  // The Leave Management tab tracks LEAVE requests; duty/WFH/comp-off requests
  // stay on /approvals and the register.
  const leaves = requests.filter((r) => r.type === 'leave');
  const pendingLeaves = leaves.filter((r) => r.status === 'pending').length;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const approvedThisMonth = leaves.filter(
    (r) => r.status === 'approved' && r.reviewedAt?.slice(0, 7) === thisMonth,
  ).length;

  return (
    <div className="wrap grid">
      {/* workforce-at-a-glance KPI band */}
      <div className="kpis">
        <div className="card kpi">
          <div className="lab">Active employees</div>
          <div className="val">{headcount ?? '—'}</div>
          <div className="note">on the roster today</div>
        </div>
        <div className="card kpi">
          <div className="lab">On leave today</div>
          <div className="val" style={{ color: onLeaveToday.length ? 'var(--lm)' : 'var(--p)' }}>
            {onLeaveToday.length}
          </div>
          <div className="note">
            {onLeaveToday.length
              ? onLeaveToday.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ') +
                (onLeaveToday.length > 3 ? '…' : '')
              : 'everyone is in'}
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Leave requests pending</div>
          <div className="val" style={{ color: pendingLeaves ? 'var(--lm)' : 'var(--p)' }}>
            {pendingLeaves}
          </div>
          <div className="note">decided on the Approvals page</div>
        </div>
        <div className="card kpi">
          <div className="lab">Leaves approved</div>
          <div className="val" style={{ color: 'var(--p)' }}>{approvedThisMonth}</div>
          <div className="note">this month</div>
        </div>
      </div>

      {/* the Leave Management tab — complete request history */}
      <LeaveHistory requests={leaves} />

      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Every leave request an employee submits lands in <b>Approvals</b> for a decision and is
        tracked here from submission to its final outcome. Balances and the annual leave-salary
        working live on the <b>Leave salary</b> page; day-to-day attendance on the{' '}
        <b>Monthly register</b>.
      </p>
    </div>
  );
}
