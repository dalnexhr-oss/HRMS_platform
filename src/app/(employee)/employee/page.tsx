import { getSession } from '@/lib/server-auth';
import { inr } from '@/lib/display-formatting';
import { AvatarMenu } from '@/components/shell/AvatarMenu';
import { currentPeriodMonth } from '@/lib/business-dates';
import { getEmployeeOverview } from '@/lib/queries/employees';
import { getEmployeePolicies } from '@/lib/queries/policies';
import { getOnLeaveToday } from '@/lib/queries/leave';
import { getPayrollRun } from '@/lib/queries/payroll';
import { getMyRequests, getRequests } from '@/lib/queries/requests';
import { getMyTickets } from '@/lib/queries/helpdesk';
import { getMyCompOffs } from '@/lib/queries/compensatory-off';
import { getNotices, getReadNoticeIds } from '@/lib/queries/notices';
import { EmployeeNotices } from '@/components/employee/EmployeeNotices';
import { EmployeeApprovalSummary } from '@/components/employee/EmployeeApprovalSummary';
import { LegacySectionRedirect } from '@/components/employee/LegacySectionRedirect';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';
import styles from './overview.module.css';
import type { CompOffRow } from '@/lib/queries/compensatory-off';
import type { OnLeaveTodayRow } from '@/lib/queries/leave';
import type { NoticeView } from '@/lib/queries/notices';
import type { PayrollRunView } from '@/lib/queries/payroll';
import type { RequestView } from '@/lib/queries/requests';
import type { TicketView } from '@/lib/queries/helpdesk';

// Employee dashboard: the landing page after login. It shows a snapshot of the month, approvals,
// who is on leave today, and company notices. Every other section has its own sidebar tab.
async function MePage() {
  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  const periodMonth = currentPeriodMonth();

  // Fetch the dashboard data in parallel. The summary cards count policies, requests, tickets and
  // comp offs, so those lists are loaded here as well as on their own tabs.
  const [
    overview,
    policies,
    requests,
    tickets,
    run,
    compOffs,
    notices,
    readNoticeIds,
    onLeaveToday,
    inboxRequests,
  ] = await Promise.all([
    getEmployeeOverview(employeeId, profile?.full_name, periodMonth),
    getEmployeePolicies(employeeId),
    employeeId ? getMyRequests(employeeId) : Promise.resolve<RequestView[]>([]),
    employeeId ? getMyTickets(employeeId) : Promise.resolve<TicketView[]>([]),
    getPayrollRun(periodMonth),
    employeeId ? getMyCompOffs(employeeId) : Promise.resolve<CompOffRow[]>([]),
    getNotices(),
    employeeId ? getReadNoticeIds(employeeId) : Promise.resolve<string[]>([]),
    getOnLeaveToday().catch(() => [] as OnLeaveTodayRow[]),
    getRequests(),
  ]);

  const noticeCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const visibleNotices: NoticeView[] = notices.filter(
    (n) =>
      n.published && n.publishedAt != null && new Date(n.publishedAt).getTime() >= noticeCutoffMs,
  );
  const readNoticeSet = new Set(readNoticeIds);
  const unreadNotices = visibleNotices.filter((n) => !readNoticeSet.has(n.id)).length;
  const unread = policies.filter((p) => !p.acknowledged).length;
  const pendingRequests = requests.filter((r) => r.status === 'pending').length;
  const openTickets = tickets.filter(
    (t) => t.status === 'open' || t.status === 'in_progress',
  ).length;
  const compOffBalance = compOffs.filter((c) => c.status === 'available' && c.isApplicable).length;
  const compOffApplied = compOffs.filter((c) => c.status === 'applied').length;
  const displayName = overview.name.trim() || profile?.full_name?.trim() || 'there';

  return (
    <div className="content-container grid">
      {/* Old links such as /employee#payslips land here; send them on to the tab. */}
      <LegacySectionRedirect />
      <div className="employee-overview">
        <AvatarMenu name={displayName} avatar={profile?.avatar} align="left" />
        <div>
          <h2>Hi, {displayName.split(' ')[0]}</h2>
          <div className="entry-details">
            {/* an unlinked login has no code/branch */}
            {[overview.code, overview.branch].filter(Boolean).join(' · ') ||
              'No employee record linked'}
          </div>
        </div>
      </div>

      <UnlinkedEmployeeNotice employeeId={employeeId} />

      {/* personal snapshot */}
      <section className={styles.summary} aria-label="Your overview">
        <section aria-labelledby="monthly-overview-title">
          <div className={styles.sectionHeader}>
            <h2 id="monthly-overview-title" className={styles.sectionTitle}>
              Monthly overview
            </h2>
            <time className={styles.period} dateTime={periodMonth.slice(0, 7)}>
              {monthYear(periodMonth)}
            </time>
          </div>
          <div className={styles.cards}>
            <OverviewCard
              title="Present days"
              value={overview.present}
              tone="positive"
              note={`${overview.halfDays} half-day${overview.halfDays === 1 ? '' : 's'} · ${overview.leaves} leave day${overview.leaves === 1 ? '' : 's'}`}
            />
            <OverviewCard
              title="Hours worked"
              value={overview.workedHours}
              unit="hrs"
              note={
                overview.surplusMinutes > 0
                  ? `+${overview.surplusMinutes} min surplus`
                  : 'No surplus time'
              }
              detail={`9h 15m per day · ${overview.surplusPresentDays} present day${overview.surplusPresentDays === 1 ? '' : 's'}`}
            />
            <OverviewCard
              title="Hours remaining"
              value={overview.pendingHours}
              unit="hrs"
              tone={overview.pendingMinutes > 0 ? 'warning' : 'positive'}
              note={`Target so far: ${overview.targetHours} hrs`}
              detail={overview.pendingMinutes === 0 ? 'You’re on target' : undefined}
            />
            <OverviewCard
              title="Net pay"
              value={overview.netPay != null ? inr(overview.netPay) : '—'}
              tone="brand"
              note={run ? `Payroll ${runStatusLabel[run.status]}` : 'Payroll not calculated yet'}
            />
          </div>
        </section>
        <section aria-labelledby="current-status-title">
          <div className={styles.sectionHeader}>
            <h2 id="current-status-title" className={styles.sectionTitle}>
              Current status
            </h2>
          </div>
          <div className={styles.cards}>
            <OverviewCard
              title="Available comp-offs"
              value={compOffBalance}
              tone={compOffBalance > 0 ? 'positive' : 'muted'}
              note={`${compOffs.length} earned in total`}
              detail={compOffApplied > 0 ? `${compOffApplied} awaiting approval` : undefined}
            />
            <OverviewCard
              title="Unread policies"
              value={unread}
              tone={unread ? 'warning' : 'positive'}
              note={`${policies.length} ${policies.length === 1 ? 'policy' : 'policies'} published`}
            />
            <OverviewCard
              title="Pending requests"
              value={pendingRequests}
              tone={pendingRequests ? 'warning' : 'positive'}
              note={`${requests.length} ${requests.length === 1 ? 'request' : 'requests'} submitted`}
            />
            <OverviewCard
              title="Open tickets"
              value={openTickets}
              tone={openTickets ? 'warning' : 'positive'}
              note={`${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'} raised`}
            />
          </div>
        </section>
      </section>

      {profile && (
        <EmployeeApprovalSummary
          requests={inboxRequests}
          actor={{ id: profile.id, employeeId, role: profile.role }}
        />
      )}

      {/* who is out today — approved leaves overlapping today's date */}
      <div className="card" id="on-leave-today">
        <div className="card-header">
          <h3>On leave today</h3>
          <span className="card-caption">
            {onLeaveToday.length === 0
              ? 'everyone is in'
              : `${onLeaveToday.length} ${onLeaveToday.length === 1 ? 'colleague' : 'colleagues'}`}
          </span>
        </div>
        <div className="card-body">
          {onLeaveToday.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              No approved leaves overlap today.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {onLeaveToday.map((p) => (
                <span
                  key={p.employeeId}
                  className="status-badge"
                  style={{
                    borderColor: 'var(--attendance-late-border)',
                    color: 'var(--attendance-late)',
                    background: 'var(--attendance-late-background)',
                  }}
                  title={`${p.startDate === p.endDate ? p.startDate : `${p.startDate} – ${p.endDate}`}`}
                >
                  <b>{p.name}</b>
                  {p.branch ? <span style={{ opacity: 0.75 }}>&nbsp;· {p.branch}</span> : null}
                  &nbsp;— On Leave Today
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* company notices — the ids on these sections are notification targets ('/employee#notices' etc); NotificationBell scrolls to them on click. */}
      <div className="card" id="notices">
        <div className="card-header">
          <h3>Notices</h3>
          <span className="card-caption">
            {unreadNotices > 0 ? `${unreadNotices} unread · ` : ''}
            {visibleNotices.length} total
          </span>
        </div>
        <div className="card-body">
          <EmployeeNotices
            notices={visibleNotices}
            readIds={readNoticeIds}
            canMark={!!employeeId}
          />
        </div>
      </div>
    </div>
  );
}

const runStatusLabel: Record<PayrollRunView['status'], string> = {
  draft: 'draft',
  in_review: 'in review',
  locked: 'locked',
  paid: 'paid',
};

function OverviewCard({
  title,
  value,
  unit,
  tone = 'default',
  note,
  detail,
}: {
  title: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'positive' | 'warning' | 'muted' | 'brand';
  note: string;
  detail?: string;
}) {
  return (
    <article className={`card summary-card ${styles.card}`}>
      <div className={styles.heading}>
        <h3 className={styles.title}>{title}</h3>
      </div>
      <div className={styles.value} data-tone={tone}>
        {value}
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
      <div className={styles.notes}>
        <p className={styles.note}>{note}</p>
        {detail && <p className={styles.detail}>{detail}</p>}
      </div>
    </article>
  );
}

/** 'yyyy-MM-dd' -> 'monthname yyyy'. */
function monthYear(periodMonth: string): string {
  return new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export { MePage as default };
