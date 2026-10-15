import { todayIST } from '@/lib/display-formatting';
import { LeaveHistory } from './LeaveHistory';
import type { RequestView } from '@/lib/queries/requests';
import type { OnLeaveTodayRow } from '@/lib/queries/leave';

function LeaveScreen({
  requests,
  onLeaveToday,
  headcount,
}: {
  requests: RequestView[];
  onLeaveToday: OnLeaveTodayRow[];
  headcount: number | null;
}) {
  const leaves = requests.filter((r) => r.type === 'leave');
  const pendingLeaves = leaves.filter((r) => r.status === 'pending').length;
  const thisMonth = todayIST().slice(0, 7);
  const approvedThisMonth = leaves.filter(
    (r) => r.status === 'approved' && r.reviewedAt?.slice(0, 7) === thisMonth,
  ).length;

  return (
    <div className="content-container grid leave-management-page">
      {/* workforce-at-a-glance KPI band */}
      <div className="summary-cards">
        <div className="card summary-card">
          <div className="metric-label">Active employees</div>
          <div className="metric-value">{headcount ?? '—'}</div>
          <div className="metric-note">on the roster today</div>
        </div>
        <div className="card summary-card">
          <div className="metric-label">On leave today</div>
          <div
            className="metric-value"
            style={{
              color: onLeaveToday.length ? 'var(--attendance-late)' : 'var(--attendance-present)',
            }}
          >
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
          <div
            className="metric-value"
            style={{
              color: pendingLeaves ? 'var(--attendance-late)' : 'var(--attendance-present)',
            }}
          >
            {pendingLeaves}
          </div>
          <div className="metric-note">decided on the Approvals page</div>
        </div>
        <div className="card summary-card">
          <div className="metric-label">Leaves approved</div>
          <div className="metric-value leave-management-approved">{approvedThisMonth}</div>
          <div className="metric-note">this month</div>
        </div>
      </div>

      {/* the Leave Management tab — complete request history */}
      <LeaveHistory requests={leaves} />

      <p className="text-muted leave-management-note">
        Every leave request an employee submits lands in <b>Approvals</b> for a decision and is
        tracked here from submission to its final outcome. Balances and the annual leave-salary
        working live on the <b>Leave salary</b> page; day-to-day attendance on the{' '}
        <b>Monthly register</b>.
      </p>
    </div>
  );
}

export { LeaveScreen };
