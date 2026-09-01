import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { todayIST } from '@/lib/format';
import { AvatarMenu } from '@/components/shell/AvatarMenu';
import {
  currentPeriodMonth,
  getEmployeeOverview,
  getEmployeePolicies,
  getLeaveBalances,
  getMyAttendance,
  getMyPayslips,
  getMyRequests,
  getMyTickets,
  getTicketComments,
  getMyCompOffs,
  getMyReimbursements,
  getReimbursementRate,
  getMyAssets,
  getMyItems,
  getEmployeeDocuments,
  getMyOnboardingTasks,
  getPayrollRun,
  getHolidays,
  getNotices,
  getOnLeaveToday,
  getReadNoticeIds,
  getWeekOffPolicy,
  isMongoConfigured,
  type CompOffRow,
  type HolidayView,
  type LeaveBalanceRow,
  type NoticeView,
  type PayrollRunView,
  type ReimbursementView,
  type RequestView,
  type TicketView,
  type MyAssetRow,
  type MyItemRow,
  type EmployeeDocumentRow,
  type OnboardingTaskRow,
  type OnLeaveTodayRow,
} from '@/lib/queries';
import { PolicyList } from '@/components/policies/PolicyList';
import { EmployeeNotices } from '@/components/employee/EmployeeNotices';
import { EmployeeHolidays } from '@/components/employee/EmployeeHolidays';
import { MyAttendance } from '@/components/employee/MyAttendance';
import { MyPayslips } from '@/components/employee/MyPayslips';
import { ApplyLeave } from '@/components/employee/ApplyLeave';
import { MyTickets } from '@/components/employee/MyTickets';
import { MyCompOffs } from '@/components/employee/MyCompOffs';
import { MyReimbursements } from '@/components/employee/MyReimbursements';
import { MyAssets } from '@/components/employee/MyAssets';
import { MyItems } from '@/components/employee/MyItems';
import { MyDocuments } from '@/components/employee/MyDocuments';
import { MyOnboarding } from '@/components/employee/MyOnboarding';
import { Punch } from '@/components/employee/Punch';
import { inr } from '@/lib/format';
import type { DayCell, PayslipRow } from '@/types/domain';

// Employee dashboard: personal snapshot, own attendance strip, payslips,
// leave/duty requests, helpdesk tickets and the policies they must read.
export default async function MePage() {
  const { profile, email } = await getSession();
  const employeeId = profile?.employee_id ?? null;
  const periodMonth = currentPeriodMonth();

  // Only the per-employee queries need a linked employee record; the overview
  // and policy list already handle a null id themselves.
  const [
    overview,
    policies,
    balances,
    attendance,
    payslips,
    requests,
    tickets,
    run,
    compOffs,
    reimbursements,
    ratePerKm,
    myAssets,
    myItems,
    holidays,
    notices,
    weekOffPolicy,
    readNoticeIds,
    myDocuments,
    myOnboarding,
    onLeaveToday,
  ] = await Promise.all([
      getEmployeeOverview(employeeId, profile?.full_name, periodMonth),
      getEmployeePolicies(employeeId),
      employeeId ? getLeaveBalances(employeeId) : Promise.resolve<LeaveBalanceRow[]>([]),
      employeeId
        ? getMyAttendance(employeeId, periodMonth)
        : Promise.resolve<DayCell[]>([]),
      employeeId ? getMyPayslips(employeeId) : Promise.resolve<PayslipRow[]>([]),
      employeeId ? getMyRequests(employeeId) : Promise.resolve<RequestView[]>([]),
      employeeId ? getMyTickets(employeeId) : Promise.resolve<TicketView[]>([]),
      // The run's real status — the net-pay KPI used to hard-code "draft", which
      // would misreport a locked or already-paid month as unfinished.
      getPayrollRun(periodMonth),
      employeeId ? getMyCompOffs(employeeId) : Promise.resolve<CompOffRow[]>([]),
      employeeId ? getMyReimbursements(employeeId) : Promise.resolve<ReimbursementView[]>([]),
      getReimbursementRate(),
      employeeId ? getMyAssets(employeeId) : Promise.resolve<MyAssetRow[]>([]),
      employeeId ? getMyItems(employeeId) : Promise.resolve<MyItemRow[]>([]),
      getHolidays(),
      getNotices(),
      getWeekOffPolicy(),
      employeeId ? getReadNoticeIds(employeeId) : Promise.resolve<string[]>([]),
      employeeId ? getEmployeeDocuments(employeeId) : Promise.resolve<EmployeeDocumentRow[]>([]),
      employeeId ? getMyOnboardingTasks(employeeId) : Promise.resolve<OnboardingTaskRow[]>([]),
      // Who is out today — visible to everyone; degrades to [] on failure so a
      // broken leave feed never blanks the whole dashboard.
      getOnLeaveToday().catch(() => [] as OnLeaveTodayRow[]),
    ]);

  // Notices are company announcements — every employee sees all PUBLISHED ones
  // (drafts stay staff-only), with the branch tag shown on each. They expire off
  // the dashboard 30 days after publication (and are hard-deleted from the DB by
  // the scheduled purge in /api/cron, and by the opportunistic one that runs
  // when staff publish a notice).
  // Compare epoch millis, not raw strings: a stored timestamp may serialise as
  // '…+00:00' while toISOString() emits '…Z', so a lexicographic compare is
  // unreliable.
  // Ticket follow-up threads depend on the loaded ticket ids, so fetch after.
  const ticketComments = await getTicketComments(tickets.map((t) => t.id));

  const noticeCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const visibleNotices: NoticeView[] = notices.filter(
    (n) => n.published && n.publishedAt != null && new Date(n.publishedAt).getTime() >= noticeCutoffMs,
  );
  const readNoticeSet = new Set(readNoticeIds);
  const unreadNotices = visibleNotices.filter((n) => !readNoticeSet.has(n.id)).length;
  // Holidays legitimately differ by branch, so scope those to the employee's
  // branch plus any all-branches entries.
  const myBranch = overview.branch || null;
  const visibleHolidays: HolidayView[] = holidays.filter(
    (h) => !h.branch || h.branch === myBranch,
  );
  const todayStr = todayIST();
  const upcomingHolidayCount = visibleHolidays.filter((h) => h.date >= todayStr).length;

  const unread = policies.filter((p) => !p.acknowledged).length;
  const pendingRequests = requests.filter((r) => r.status === 'pending').length;
  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  // Comp-off credits the employee can actually spend. A credit staff put on hold
  // (is_applicable=false) is still 'available' but cannot be applied against, so
  // counting on status alone would advertise a balance applyCompOff refuses.
  // Same rule as the Comp offs card, so the two never disagree.
  const compOffBalance = compOffs.filter((c) => c.status === 'available' && c.isApplicable).length;
  const compOffApplied = compOffs.filter((c) => c.status === 'applied').length;

  // createTicket writes `employee_id: profile.employee_id`, so an unlinked login
  // would file a ticket that never appears in "My tickets" below; and with no
  // the database it returns {ok:true} without writing at all. Gate the form on both
  // rather than render a control that green-ticks over nothing.
  // getEmployeeOverview returns name:'' for an unlinked login with no full_name,
  // which would render "Hi, " and a blank avatar.
  const displayName = overview.name.trim() || profile?.full_name?.trim() || 'there';

  const canRaiseTicket = isMongoConfigured() && !!employeeId;
  const ticketBlockedReason = !isMongoConfigured()
    ? 'The database is not configured, so a ticket cannot be saved.'
    : 'Your login is not linked to an employee record, so a ticket could not be traced back to you. Ask HR to link it.';

  return (
    <div className="wrap grid">
      <div className="me-hero">
        <AvatarMenu name={displayName} avatar={profile?.avatar} align="left" />
        <div>
          <h2>Hi, {displayName.split(' ')[0]}</h2>
          <div className="meta">
            {/* an unlinked login has no code/branch — don't render a naked '·' */}
            {[overview.code, overview.branch].filter(Boolean).join(' · ') || 'No employee record linked'}
          </div>
        </div>
      </div>

      {!employeeId && (
        <div className="card">
          <div className="bd">
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Your login is not linked to an employee record yet, so your attendance, payslips,
              requests and tickets cannot be shown. Ask HR to link your account.
            </p>
          </div>
        </div>
      )}

      {/* personal snapshot */}
      <div className="kpis">
        <div className="card kpi">
          <div className="lab">Present · {monthName(periodMonth)}</div>
          <div className="val" style={{ color: 'var(--p)' }}>
            {overview.present}
          </div>
          <div className="note">
            {overview.halfDays} half-day{overview.halfDays === 1 ? '' : 's'} · {overview.leaves} leave
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Hours worked · {monthName(periodMonth)}</div>
          <div className="val mono" style={{ fontSize: 26, paddingTop: 8 }}>
            {overview.workedHours}
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Pending hours · {monthName(periodMonth)}</div>
          <div
            className="val mono"
            style={{
              fontSize: 26,
              paddingTop: 8,
              color: overview.pendingMinutes > 0 ? 'var(--lm)' : 'var(--p)',
            }}
          >
            {overview.pendingHours}
          </div>
          <div className="note">
            {overview.pendingMinutes > 0
              ? `of ${overview.targetHours} due so far this month`
              : 'you are on target'}
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Comp offs remaining</div>
          <div className="val" style={{ color: compOffBalance > 0 ? 'var(--p)' : 'var(--ink-3)' }}>
            {compOffBalance}
          </div>
          <div className="note">
            {compOffApplied > 0
              ? `${compOffApplied} awaiting approval · ${compOffs.length} earned in total`
              : `${compOffs.length} earned in total`}
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Net pay · {monthName(periodMonth)}</div>
          <div className="val" style={{ fontSize: 26, paddingTop: 8, color: 'var(--brand-deep)' }}>
            {overview.netPay != null ? inr(overview.netPay) : '—'}
          </div>
          <div className="note">
            {monthYear(periodMonth)} ·{' '}
            {run ? RUN_STATUS_LABEL[run.status] : 'not computed yet'}
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Policies to read</div>
          <div className="val" style={{ color: unread ? 'var(--hd)' : 'var(--p)' }}>
            {unread}
          </div>
          <div className="note">{policies.length} published in total</div>
        </div>
        <div className="card kpi">
          <div className="lab">Requests pending</div>
          <div className="val" style={{ color: pendingRequests ? 'var(--lm)' : 'var(--p)' }}>
            {pendingRequests}
          </div>
          <div className="note">{requests.length} filed in total</div>
        </div>
        <div className="card kpi">
          <div className="lab">Open tickets</div>
          <div className="val" style={{ color: openTickets ? 'var(--lm)' : 'var(--p)' }}>
            {openTickets}
          </div>
          <div className="note">{tickets.length} raised in total</div>
        </div>
      </div>

      {/* who is out today — approved leaves overlapping today's date */}
      <div className="card" id="on-leave-today">
        <div className="hd">
          <h3>On leave today</h3>
          <span className="folio">
            {onLeaveToday.length === 0
              ? 'everyone is in'
              : `${onLeaveToday.length} ${onLeaveToday.length === 1 ? 'colleague' : 'colleagues'}`}
          </span>
        </div>
        <div className="bd">
          {onLeaveToday.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              No approved leaves overlap today.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {onLeaveToday.map((p) => (
                <span
                  key={p.employeeId}
                  className="pill"
                  style={{ borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' }}
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

      {/* company notices — the ids on these sections are notification targets
          ('/me#notices' etc); NotificationBell scrolls to them on click. */}
      <div className="card" id="notices">
        <div className="hd">
          <h3>Notices</h3>
          <span className="folio">
            {unreadNotices > 0 ? `${unreadNotices} unread · ` : ''}
            {visibleNotices.length} total
          </span>
        </div>
        <div className="bd">
          <EmployeeNotices
            notices={visibleNotices}
            readIds={readNoticeIds}
            canMark={!!employeeId}
          />
        </div>
      </div>

      {/* holiday calendar */}
      <div className="card" id="holidays">
        <div className="hd">
          <h3>Holiday calendar</h3>
          <span className="folio">
            {upcomingHolidayCount} upcoming · {visibleHolidays.length} total
          </span>
        </div>
        <div className="bd">
          <EmployeeHolidays holidays={visibleHolidays} policy={weekOffPolicy} />
        </div>
      </div>

      {/* joiner checklist — read-only; ticking a step is a staff action */}
      <MyOnboarding tasks={myOnboarding} id="onboarding" />

      {/* own document locker — upload what HR asked for, track verification */}
      <MyDocuments documents={myDocuments} id="documents" />

      {/* live clock — the one thing done every day, so it sits above the strip */}
      <Punch id="punch" />

      {/* own month strip */}
      <MyAttendance days={attendance} periodMonth={periodMonth} id="attendance" />

      {/* leave / duty requests + balances */}
      <ApplyLeave
        requests={requests}
        balances={balances}
        canApply={!!employeeId}
        compOffBalance={compOffBalance}
        id="leave"
      />

      {/* comp offs earned by working an off day */}
      <MyCompOffs
        compOffs={compOffs}
        canApply={canRaiseTicket}
        blockedReason={ticketBlockedReason}
        id="comp-offs"
      />

      {/* payslips */}
      <MyPayslips payslips={payslips} id="payslips" />

      {/* expense claims */}
      <MyReimbursements
        claims={reimbursements}
        ratePerKm={ratePerKm}
        canClaim={canRaiseTicket}
        blockedReason={ticketBlockedReason}
        id="reimbursements"
      />

      {/* equipment assigned to me */}
      <MyAssets assets={myAssets} id="assets" />
      <MyItems items={myItems} id="items" />

      {/* helpdesk */}
      <MyTickets
        tickets={tickets}
        comments={ticketComments}
        selfId={profile?.id ?? null}
        canRaise={canRaiseTicket}
        blockedReason={ticketBlockedReason}
        id="tickets"
      />

      {/* company policies */}
      <div className="card" id="policies">
        <div className="hd">
          <h3>Company policies</h3>
          <span className="folio">Please read &amp; acknowledge</span>
        </div>
        <div className="bd">
          <PolicyList policies={policies} />
        </div>
      </div>

      {/* account security lives on its own page now */}
      <div className="card">
        <div className="hd">
          <h3>My account</h3>
          <span className="folio">{email ?? 'your account'}</span>
        </div>
        <div className="bd">
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Manage your profile picture and password on your account page.
          </p>
          <Link href="/me/account" className="btn">
            Manage your account →
          </Link>
        </div>
      </div>
    </div>
  );
}

const RUN_STATUS_LABEL: Record<PayrollRunView['status'], string> = {
  draft: 'draft',
  in_review: 'in review',
  locked: 'locked',
  paid: 'paid',
};

/** '2026-06-01' -> 'June'. */
function monthName(periodMonth: string): string {
  return new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
}

/** '2026-06-01' -> 'June 2026'. */
function monthYear(periodMonth: string): string {
  return new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
