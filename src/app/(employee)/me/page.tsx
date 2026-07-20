import { getSession } from '@/lib/auth';
import {
  DEFAULT_PERIOD_MONTH,
  getEmployeeOverview,
  getEmployeePolicies,
  getLeaveBalances,
  getMyAttendance,
  getMyPayslips,
  getMyRequests,
  getMyTickets,
  getPayrollRun,
  isSupabaseConfigured,
  type LeaveBalanceRow,
  type PayrollRunView,
  type RequestView,
  type TicketView,
} from '@/lib/queries';
import { PolicyList } from '@/components/policies/PolicyList';
import { MyAttendance } from '@/components/employee/MyAttendance';
import { MyPayslips } from '@/components/employee/MyPayslips';
import { ApplyLeave } from '@/components/employee/ApplyLeave';
import { MyTickets } from '@/components/employee/MyTickets';
import { inr } from '@/lib/format';
import type { DayCell, PayslipRow } from '@/types/domain';

// Employee dashboard: personal snapshot, own attendance strip, payslips,
// leave/duty requests, helpdesk tickets and the policies they must read.
export default async function MePage() {
  const { profile } = await getSession();
  const employeeId = profile?.employee_id ?? null;

  // Only the per-employee queries need a linked employee record; the overview
  // and policy list already handle a null id themselves.
  const [overview, policies, balances, attendance, payslips, requests, tickets, run] =
    await Promise.all([
      getEmployeeOverview(employeeId, profile?.full_name, DEFAULT_PERIOD_MONTH),
      getEmployeePolicies(employeeId),
      employeeId ? getLeaveBalances(employeeId) : Promise.resolve<LeaveBalanceRow[]>([]),
      employeeId
        ? getMyAttendance(employeeId, DEFAULT_PERIOD_MONTH)
        : Promise.resolve<DayCell[]>([]),
      employeeId ? getMyPayslips(employeeId) : Promise.resolve<PayslipRow[]>([]),
      employeeId ? getMyRequests(employeeId) : Promise.resolve<RequestView[]>([]),
      employeeId ? getMyTickets(employeeId) : Promise.resolve<TicketView[]>([]),
      // The run's real status — the net-pay KPI used to hard-code "draft", which
      // would misreport a locked or already-paid month as unfinished.
      getPayrollRun(DEFAULT_PERIOD_MONTH),
    ]);

  const unread = policies.filter((p) => !p.acknowledged).length;
  const pendingRequests = requests.filter((r) => r.status === 'pending').length;
  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  // createTicket writes `employee_id: profile.employee_id`, so an unlinked login
  // would file a ticket that never appears in "My tickets" below; and with no
  // Supabase it returns {ok:true} without writing at all. Gate the form on both
  // rather than render a control that green-ticks over nothing.
  // getEmployeeOverview returns name:'' for an unlinked login with no full_name,
  // which would render "Hi, " and a blank avatar.
  const displayName = overview.name.trim() || profile?.full_name?.trim() || 'there';

  const canRaiseTicket = isSupabaseConfigured() && !!employeeId;
  const ticketBlockedReason = !isSupabaseConfigured()
    ? 'The database is not configured, so a ticket cannot be saved.'
    : 'Your login is not linked to an employee record, so a ticket could not be traced back to you. Ask HR to link it.';

  return (
    <div className="wrap grid">
      <div className="me-hero">
        <span className="av">{initials(displayName)}</span>
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
          <div className="lab">Present · {monthName(DEFAULT_PERIOD_MONTH)}</div>
          <div className="val" style={{ color: 'var(--p)' }}>
            {overview.present}
          </div>
          <div className="note">
            {overview.halfDays} half-day{overview.halfDays === 1 ? '' : 's'} · {overview.leaves} leave
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Hours worked · {monthName(DEFAULT_PERIOD_MONTH)}</div>
          <div className="val mono" style={{ fontSize: 26, paddingTop: 8 }}>
            {overview.workedHours}
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Net pay · {monthName(DEFAULT_PERIOD_MONTH)}</div>
          <div className="val" style={{ fontSize: 26, paddingTop: 8, color: 'var(--brand-deep)' }}>
            {overview.netPay != null ? inr(overview.netPay) : '—'}
          </div>
          <div className="note">
            {monthYear(DEFAULT_PERIOD_MONTH)} ·{' '}
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

      {/* own month strip */}
      <MyAttendance days={attendance} periodMonth={DEFAULT_PERIOD_MONTH} />

      {/* leave / duty requests + balances */}
      <ApplyLeave requests={requests} balances={balances} canApply={!!employeeId} />

      {/* payslips */}
      <MyPayslips payslips={payslips} />

      {/* helpdesk */}
      <MyTickets tickets={tickets} canRaise={canRaiseTicket} blockedReason={ticketBlockedReason} />

      {/* company policies */}
      <div className="card">
        <div className="hd">
          <h3>Company policies</h3>
          <span className="folio">Please read &amp; acknowledge</span>
        </div>
        <div className="bd">
          <PolicyList policies={policies} />
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

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
