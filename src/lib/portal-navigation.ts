// Portal navigation.

// Shared sidebar groups keep navigation labels and grouping consistent.
const groups = {
  ATTENDANCE: 'Attendance',
  WORKFORCE: 'Workforce',
  HR: 'HR',
  RESOURCES: 'Resources',
  COMPANY: 'Company',
  ADMIN: 'Admin',
} as const;

type NavGroup = (typeof groups)[keyof typeof groups];

// Render groups in this order and skip groups with no visible tabs.
const groupOrder: NavGroup[] = [
  groups.ATTENDANCE,
  groups.WORKFORCE,
  groups.HR,
  groups.RESOURCES,
  groups.COMPANY,
  groups.ADMIN,
];

interface NavItem {
  slug: string;
  label: string;
  group: NavGroup;
}

// Sidebar rows in group order. Keep Users and Import here so titles and access rules use the same
// slugs. Personal account settings belong in the profile menu.
const navItems: NavItem[] = [
  { slug: 'dashboard', label: 'Dashboard', group: groups.ATTENDANCE },
  { slug: 'monthly-register', label: 'Monthly register', group: groups.ATTENDANCE },
  { slug: 'attendance-audit', label: 'Attendance audit', group: groups.ATTENDANCE },
  { slug: 'approvals', label: 'Approvals', group: groups.ATTENDANCE },
  { slug: 'tv-dashboard', label: 'TV dashboard', group: groups.ATTENDANCE },

  { slug: 'employees', label: 'Employees', group: groups.WORKFORCE },
  { slug: 'onboarding', label: 'Onboarding', group: groups.WORKFORCE },
  { slug: 'documents', label: 'Documents', group: groups.WORKFORCE },
  { slug: 'exits', label: 'Exits', group: groups.WORKFORCE },

  { slug: 'leave-management', label: 'Leave Management', group: groups.HR },
  { slug: 'leave-salary', label: 'Leave salary', group: groups.HR },
  { slug: 'payroll', label: 'Payroll', group: groups.HR },
  { slug: 'reimbursements', label: 'Reimbursements', group: groups.HR },

  { slug: 'asset-management', label: 'Asset management', group: groups.RESOURCES },
  { slug: 'inventory-management', label: 'Inventory management', group: groups.RESOURCES },

  { slug: 'company-policies', label: 'Company policies', group: groups.COMPANY },
  { slug: 'holidays', label: 'Holidays', group: groups.COMPANY },
  { slug: 'notices', label: 'Notices', group: groups.COMPANY },
  { slug: 'helpdesk', label: 'Helpdesk', group: groups.COMPANY },

  { slug: 'users', label: 'Users', group: groups.ADMIN },
  { slug: 'data-import', label: 'Attendance import', group: groups.ADMIN },
  { slug: 'settings', label: 'Settings', group: groups.ADMIN },
];

// Hide tabs unavailable to the role. Pages and actions enforce their own authorization checks.
const tabRoleAccess: Record<string, readonly string[]> = {
  'attendance-audit': ['super_admin', 'admin', 'hr'],
  onboarding: ['super_admin', 'admin', 'hr'],
  documents: ['super_admin', 'admin', 'hr'],
  exits: ['super_admin', 'admin', 'hr'],
  'leave-management': ['super_admin', 'admin', 'hr'],
  'leave-salary': ['super_admin', 'admin', 'hr'],
  'asset-management': ['super_admin', 'admin', 'hr'],
  'inventory-management': ['super_admin', 'admin', 'hr'],
  users: ['super_admin', 'admin', 'hr'],
  'tv-dashboard': ['super_admin', 'admin', 'hr'],
  'data-import': ['super_admin', 'admin', 'hr'],
  settings: ['super_admin', 'admin', 'hr'],
};

// Static titles and fallback subtitles by slug. pageHeader supplies dates and counts from live
// data.
const tabTitles: Record<string, [string, string]> = {
  dashboard: ['Dashboard', 'Live attendance '],
  'monthly-register': ['Monthly register', 'Attendance by month'],
  'attendance-audit': ['Attendance audit', 'Who edited attendance & why'],
  'tv-dashboard': ['TV dashboard', 'Live employee attendance'],
  'leave-management': ['Leave Management', 'Manage employee leave requests'],
  'leave-salary': ['Leave salary', 'Leave salary & payroll'],
  exits: ['Exits', 'Clearance, settlement & documents'],
  onboarding: ['Onboarding', 'Joiner checklist & documents'],
  documents: ['Documents', 'Employee document register'],
  payroll: ['Payroll', 'Salary runs & payslips'],
  reimbursements: ['Reimbursements', 'Employee claims & approvals'],
  employees: ['Employees', 'Staff directory'],
  'asset-management': ['Asset management', 'IT assets'],
  'inventory-management': ['Inventory management', 'Stock, tools & assignments'],
  'company-policies': ['Company policies', 'Published to employee dashboards'],
  approvals: ['Approvals', 'Leave & duty requests'],
  holidays: ['Holidays', 'Holiday calendar'],
  notices: ['Notices', 'Policy bulletin'],
  helpdesk: ['Helpdesk', 'Employee tickets'],
  settings: ['Settings', 'Rules & thresholds'],
  users: ['Users', 'Login accounts & roles'],
  'data-import': ['Attendance import', 'Import monthly attendance from Excel'],
  account: ['My account', 'Your profile & password'],
};

// Server-formatted dates keep topbar hydration consistent. Keep this client-safe contract outside
// the server-only queries module.
interface TopbarStats {
  // e.g. 'Saturday, 25 July YYYY' — today in the business timezone.
  todayLabel: string;
  // e.g. 'July YYYY' — the current payroll period.
  periodLabel: string;
  // Current year in the business timezone.
  year: number;
  // Active head-count, or null when the lookup failed.
  activeEmployees: number | null;
  // Branch names, for the '· Pune & Vadodara' tail.
  branches: string[];
  // Requests awaiting a decision, or null when the lookup failed.
  pendingApprovals: number | null;
  // payroll_runs.status for the current period; null when there is no run.
  runStatus: string | null;
  // Configured auto punch-out time, already formatted ('11:00 PM').
  nightSweep: string | null;
}

const runStatusLabel: Record<string, string> = {
  draft: 'draft',
  in_review: 'in review',
  locked: 'locked',
  paid: 'paid',
};

// Title + subtitle for a page. Falls back to the static tabTitles row whenever the figure behind a
// subtitle is unavailable, so a failed count degrades to a plain description rather than to a wrong
// number.
function pageHeader(slug: string, stats?: TopbarStats | null): [string, string] {
  const [title, fallback] = tabTitles[slug] ?? ['', ''];
  if (!stats) {
    return [title, fallback];
  }

  switch (slug) {
    case 'dashboard':
      return [title, `${stats.todayLabel}`];

    case 'monthly-register': {
      // A register reads as "closed" once its payroll can no longer be recomputed.
      const closed = stats.runStatus === 'locked' || stats.runStatus === 'paid';
      return [title, `${stats.periodLabel}\n${closed ? 'Closed' : 'Active'}`];
    }

    case 'payroll': {
      const status = stats.runStatus ? (runStatusLabel[stats.runStatus] ?? stats.runStatus) : null;
      return [title, `${stats.periodLabel} · ${status ?? 'no run yet'}`];
    }

    case 'employees': {
      if (stats.activeEmployees == null) {
        return [title, fallback];
      }
      const where = stats.branches.length ? `\n${stats.branches.join(' & ')}` : '';

      return [title, `${stats.activeEmployees} active${where}`];
    }

    case 'approvals': {
      if (stats.pendingApprovals == null) {
        return [title, fallback];
      }
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

export { groups, groupOrder, navItems, tabRoleAccess, tabTitles, pageHeader };

export type { TopbarStats, NavGroup, NavItem };
