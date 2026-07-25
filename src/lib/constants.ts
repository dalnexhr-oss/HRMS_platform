import type { AttendanceStatus } from '@/types/database';

// Status stamp metadata: [short label, css class, human label].
// Ported from STATUS_META in the prototype. 'S'/'T' reuse the outdoor-duty style.
export const STATUS_META: Record<string, [string, string, string]> = {
  P: ['P', 'st-P', 'Present'],
  LM: ['LM', 'st-LM', 'Late mark'],
  HD: ['HD', 'st-HD', 'Half day'],
  L: ['L', 'st-L', 'Leave'],
  WO: ['WO', 'st-WO', 'Week off'],
  OH: ['OH', 'st-OH', 'Holiday'],
  AB: ['A', 'st-AB', 'Absent'],
  S: ['S', 'st-OD', 'Site'],
  T: ['T', 'st-OD', 'Travel'],
  // Comp off (migration 0006). Reuses the holiday stamp style — a taken comp off
  // is a paid day off — rather than adding a class, so globals.css stays as
  // ported. Without this entry statusMeta() fell back to 'P' and a CO day
  // rendered as Present.
  CO: ['CO', 'st-OH', 'Comp off'],
};

export function statusMeta(s: AttendanceStatus | string) {
  return STATUS_META[s] ?? STATUS_META.P;
}

export const REGISTER_LEGEND: [AttendanceStatus, string][] = [
  ['P', 'Present'],
  ['LM', 'Late mark'],
  ['HD', 'Half day'],
  ['L', 'Leave'],
  ['WO', 'Week off'],
  ['OH', 'Holiday'],
  ['CO', 'Comp off'],
  ['S', 'Site / travel'],
];

export const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Portal navigation model (mirrors the sidebar in the prototype).
export interface NavItem {
  slug: string;
  label: string;
  group: string;
}

export const NAV: NavItem[] = [
  { slug: 'today', label: 'Today', group: 'Operate' },
  { slug: 'register', label: 'Monthly register', group: 'Operate' },
  { slug: 'approvals', label: 'Approvals', group: 'Operate' },
  { slug: 'payroll', label: 'Payroll', group: 'Pay' },
  { slug: 'reimbursements', label: 'Reimbursements', group: 'Pay' },
  { slug: 'employees', label: 'Employees', group: 'People' },
  { slug: 'assets', label: 'Asset Management', group: 'People' },
  { slug: 'items', label: 'Item Management', group: 'People' },
  { slug: 'policies', label: 'Company policies', group: 'People' },
  { slug: 'holidays', label: 'Holidays', group: 'More' },
  { slug: 'notices', label: 'Notices', group: 'More' },
  { slug: 'helpdesk', label: 'Helpdesk', group: 'More' },
  { slug: 'settings', label: 'Settings', group: 'More' },
  { slug: 'account', label: 'My account', group: 'More' },
];

/**
 * Nav items only some roles may see. The page itself re-checks and redirects —
 * this just avoids showing a link that would bounce.
 */
export const NAV_ROLE_GATED: Record<string, readonly string[]> = {
  users: ['admin', 'hr'],
  assets: ['admin', 'hr'],
  items: ['admin', 'hr'],
};

// Page titles + FALLBACK subtitles keyed by slug. These are deliberately plain
// descriptions: anything carrying a live figure (today's date, the current
// period, head-counts, pending queues) is filled in by pageHeader() from real
// data, so a stale number is never invented here. The prototype's hardcoded
// "Wednesday, 8 July 2026", "45 active" and "2 pending" used to live in this map.
export const TITLES: Record<string, [string, string]> = {
  today: ['Today', 'Live attendance · IST'],
  register: ['Monthly register', 'Attendance by month'],
  payroll: ['Payroll', 'Salary runs & payslips'],
  reimbursements: ['Reimbursements', 'Expense claims · approve & pay'],
  employees: ['Employees', 'Staff directory'],
  assets: ['Asset Management', 'Company IT assets'],
  items: ['Item Management', 'Inventory & assignments'],
  policies: ['Company policies', 'Published to employee dashboards'],
  approvals: ['Approvals', 'Leave & duty requests'],
  holidays: ['Holidays', 'Holiday calendar'],
  notices: ['Notices', 'Policy bulletin'],
  helpdesk: ['Helpdesk', 'Employee tickets'],
  settings: ['Settings', 'Rules & thresholds'],
  users: ['Users', 'Login accounts & roles'],
  account: ['My account', 'Your profile & password'],
};

/**
 * Live figures behind the topbar subtitles, resolved by the portal layout (see
 * getTopbarStats). Date labels are pre-formatted on the SERVER so the client
 * cannot hydrate a different day.
 *
 * The interface lives here rather than in queries.ts so the client-side Topbar
 * can import it without dragging a server-only module into the browser bundle.
 */
export interface TopbarStats {
  /** e.g. 'Saturday, 25 July 2026' — today in the business timezone. */
  todayLabel: string;
  /** e.g. 'July 2026' — the current payroll period. */
  periodLabel: string;
  /** Current year in the business timezone. */
  year: number;
  /** Active head-count, or null when the lookup failed. */
  activeEmployees: number | null;
  /** Branch names, for the '· Pune & Vadodara' tail. */
  branches: string[];
  /** Requests awaiting a decision, or null when the lookup failed. */
  pendingApprovals: number | null;
  /** payroll_runs.status for the current period; null when there is no run. */
  runStatus: string | null;
  /** Configured auto punch-out time, already formatted ('11:00 PM'). */
  nightSweep: string | null;
}

const RUN_STATUS_LABEL: Record<string, string> = {
  draft: 'draft',
  in_review: 'in review',
  locked: 'locked',
  paid: 'paid',
};

/**
 * Title + subtitle for a page. Falls back to the static TITLES row whenever the
 * figure behind a subtitle is unavailable, so a failed count degrades to a plain
 * description rather than to a wrong number.
 */
export function pageHeader(slug: string, stats?: TopbarStats | null): [string, string] {
  const [title, fallback] = TITLES[slug] ?? ['', ''];
  if (!stats) return [title, fallback];

  switch (slug) {
    case 'today':
      return [title, `${stats.todayLabel} · IST`];

    case 'register': {
      // A register reads as "closed" once its payroll can no longer be recomputed.
      const closed = stats.runStatus === 'locked' || stats.runStatus === 'paid';
      return [title, `${stats.periodLabel} · ${closed ? 'closed' : 'open'}`];
    }

    case 'payroll': {
      const status = stats.runStatus ? RUN_STATUS_LABEL[stats.runStatus] ?? stats.runStatus : null;
      return [title, `${stats.periodLabel} · ${status ?? 'no run yet'}`];
    }

    case 'employees': {
      if (stats.activeEmployees == null) return [title, fallback];
      const where = stats.branches.length ? ` · ${stats.branches.join(' & ')}` : '';
      return [title, `${stats.activeEmployees} active${where}`];
    }

    case 'approvals': {
      if (stats.pendingApprovals == null) return [title, fallback];
      return [
        title,
        stats.pendingApprovals === 0 ? 'Nothing pending' : `${stats.pendingApprovals} pending`,
      ];
    }

    case 'holidays':
      return [title, `${stats.year} calendar`];

    default:
      return [title, fallback];
  }
}
