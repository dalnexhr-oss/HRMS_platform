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

/**
 * Document types offered when an employee files paperwork. Free text in the DB;
 * this just keeps the drop-down tidy.
 *
 * It lives here rather than beside the upload action because that module is
 * `'use server'`, and Next allows only async function exports from one — a
 * plain const there fails the build.
 */
export const DOCUMENT_CATEGORIES = [
  'offer_letter',
  'id_proof',
  'education',
  'experience',
  'bank',
  'other',
] as const;

/**
 * Every Indian state and union territory a branch may be registered in.
 * Must stay in lockstep with the `indian_state` enum (0001, extended in 0040) —
 * the branch form offers these and resolveBranch validates against them, but the
 * database enum has the final word.
 *
 * Note on payroll: professional tax comes from pt_slabs, which only seeds
 * Maharashtra and Gujarat. fn_professional_tax returns 0 when a state has no
 * slab rows, so a branch in any other state computes PT as nil until its slabs
 * are added.
 */
export const INDIAN_STATES = [
  // States (28)
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  // Union territories (8)
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

// ---------------------------------------------------------------------------
// Portal navigation model
// ---------------------------------------------------------------------------

/**
 * Sidebar section headers. Declared as constants rather than typed inline on
 * each row: a free-typed `group: 'Operations'` next to `group: 'Operate'` is
 * how Import ended up alone under its own header, and the compiler could not
 * see it. With NavItem['group'] bound to this object, the same slip is a build
 * error.
 *
 * Each name states a domain ('Attendance', 'Company') rather than a frequency
 * or a shrug — the old 'More' told the reader nothing, so every item under it
 * had to be re-read on each visit.
 */
export const GROUPS = {
  ATTENDANCE: 'Attendance',
  WORKFORCE: 'Workforce',
  HR: 'HR',
  RESOURCES: 'Resources',
  COMPANY: 'Company',
  ADMIN: 'Admin',
} as const;

export type NavGroup = (typeof GROUPS)[keyof typeof GROUPS];

/**
 * Header order in the sidebar. The renderer walks this list, not NAV, and
 * skips any group whose visible items come to zero — otherwise a role that
 * cannot see Users, Import or Settings still gets a bare 'Admin' heading.
 */
export const GROUP_ORDER: NavGroup[] = [
  GROUPS.ATTENDANCE,
  GROUPS.WORKFORCE,
  GROUPS.HR,
  GROUPS.RESOURCES,
  GROUPS.COMPANY,
  GROUPS.ADMIN,
];

export interface NavItem {
  slug: string;
  label: string;
  group: NavGroup;
}

/**
 * Every sidebar row, in render order within its group.
 *
 * `users` and `import` were previously injected by Sidebar.tsx and absent from
 * this list. That split is what let their group names drift, and why 'import'
 * had no TITLES row and no role gate. They are declared here now; Sidebar.tsx
 * must no longer add them itself.
 *
 * 'My account' is deliberately absent — a personal profile is not navigation,
 * and gating it alongside Users would have hidden it from the people who need
 * it most. It belongs in the avatar menu beside Sign out.
 */
export const NAV: NavItem[] = [
  { slug: 'today', label: 'Today', group: GROUPS.ATTENDANCE },
  { slug: 'register', label: 'Monthly register', group: GROUPS.ATTENDANCE },
  { slug: 'audit', label: 'Attendance audit', group: GROUPS.ATTENDANCE },
  { slug: 'approvals', label: 'Approvals', group: GROUPS.ATTENDANCE },

  { slug: 'employees', label: 'Employees', group: GROUPS.WORKFORCE },
  { slug: 'onboarding', label: 'Onboarding', group: GROUPS.WORKFORCE },
  { slug: 'exits', label: 'Exits', group: GROUPS.WORKFORCE },

  { slug: 'leave', label: 'Leave salary', group: GROUPS.HR },
  { slug: 'payroll', label: 'Payroll', group: GROUPS.HR },
  { slug: 'reimbursements', label: 'Reimbursements', group: GROUPS.HR },

  { slug: 'assets', label: 'Asset management', group: GROUPS.RESOURCES },
  { slug: 'items', label: 'Inventory management', group: GROUPS.RESOURCES },

  { slug: 'policies', label: 'Company policies', group: GROUPS.COMPANY },
  { slug: 'holidays', label: 'Holidays', group: GROUPS.COMPANY },
  { slug: 'notices', label: 'Notices', group: GROUPS.COMPANY },
  { slug: 'helpdesk', label: 'Helpdesk', group: GROUPS.COMPANY },

  { slug: 'users', label: 'Users', group: GROUPS.ADMIN },
  { slug: 'import', label: 'Import', group: GROUPS.ADMIN },
  { slug: 'settings', label: 'Settings', group: GROUPS.ADMIN },
];

/**
 * Nav items only some roles may see. The page itself re-checks and redirects —
 * this just avoids showing a link that would bounce.
 *
 * 'import' and 'settings' are new entries: both were reachable by every role
 * because Sidebar.tsx injected Import outside this map, and Settings was simply
 * never listed. A plain employee could open 'Rules & thresholds'.
 */
export const NAV_ROLE_GATED: Record<string, readonly string[]> = {
  audit: ['admin', 'hr', 'manager'],
  onboarding: ['admin', 'hr'],
  exits: ['admin', 'hr'],
  leave: ['admin', 'hr'],
  assets: ['admin', 'hr'],
  items: ['admin', 'hr'],
  users: ['admin', 'hr'],
  import: ['admin', 'hr'],
  settings: ['admin'],
};

// Page titles + FALLBACK subtitles keyed by slug. These are deliberately plain
// descriptions: anything carrying a live figure (today's date, the current
// period, head-counts, pending queues) is filled in by pageHeader() from real
// data, so a stale number is never invented here. The prototype's hardcoded
// "Wednesday, 8 July 2026", "45 active" and "2 pending" used to live in this map.
export const TITLES: Record<string, [string, string]> = {
  today: ['Today', 'Live attendance · IST'],
  register: ['Monthly register', 'Attendance by month'],
  audit: ['Attendance audit', 'Who edited attendance & why'],
  leave: ['Leave salary', '15-day paid leave & annual payout'],
  exits: ['Exits', 'Clearance, settlement & documents'],
  onboarding: ['Onboarding', 'Joiner checklists by owner'],
  payroll: ['Payroll', 'Salary runs & payslips'],
  reimbursements: ['Reimbursements', 'Expense claims · approve & pay'],
  employees: ['Employees', 'Staff directory'],
  assets: ['Asset management', 'Company IT assets'],
  items: ['Inventory management', 'Stock, tools & assignments'],
  policies: ['Company policies', 'Published to employee dashboards'],
  approvals: ['Approvals', 'Leave & duty requests'],
  holidays: ['Holidays', 'Holiday calendar'],
  notices: ['Notices', 'Policy bulletin'],
  helpdesk: ['Helpdesk', 'Employee tickets'],
  settings: ['Settings', 'Rules & thresholds'],
  users: ['Users', 'Login accounts & roles'],
  // Was missing entirely, so the Import page rendered a blank header.
  import: ['Import', 'Bulk upload employees & attendance'],
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