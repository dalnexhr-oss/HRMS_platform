import type { AttendanceStatus } from '@/types/database';

// Status metadata: short label, CSS class, and display label. Site and travel share the
// outdoor-duty style.
export const attendanceStatusMeta: Record<string, [string, string, string]> = {
  P: ['P', 'st-P', 'Present'],
  LM: ['LM', 'st-LM', 'Late mark'],
  HD: ['HD', 'st-HD', 'Half day'],
  L: ['L', 'st-L', 'Leave'],
  WO: ['WO', 'st-WO', 'Week off'],
  OH: ['OH', 'st-OH', 'Holiday'],
  AB: ['A', 'st-AB', 'Absent'],
  S: ['S', 'st-OD', 'Site'],
  T: ['T', 'st-OD', 'Travel'],
  // A taken comp off is paid time off, so it shares the holiday stamp style.
  CO: ['CO', 'st-OH', 'Comp off'],
};

export function statusMeta(s: AttendanceStatus | string) {
  return attendanceStatusMeta[s] ?? attendanceStatusMeta.P;
}

export const registerLegend: Array<[AttendanceStatus, string]> = [
  ['P', 'Present'],
  ['LM', 'Late mark'],
  ['HD', 'Half day'],
  ['L', 'Leave'],
  ['WO', 'Week off'],
  ['OH', 'Holiday'],
  ['CO', 'Comp off'],
  ['S', 'Site / travel'],
];

export const dow = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Assign branch colors by alphabetical index, shared by the dashboard and employee list. The
// 20-slot order alternates hues for adjacent segments. Keep text labels and segment gaps as
// additional cues; check contrast and color-vision distinguishability before changing the palette.
export const branchPalette = [
  '#2A78D6', // 1 blue
  '#06809C', // 2 teal
  '#EB6834', // 3 orange
  '#0277BD', // 4 deep sky
  '#C98500', // 5 gold
  '#109566', // 6 mint
  '#D03B3B', // 7 red
  '#4A3AA7', // 8 indigo
  '#6B21A8', // 9 purple
  '#6B8E23', // 10 olive
  '#D55181', // 11 pink
  '#008300', // 12 green
  '#8C2F39', // 13 maroon
  '#5C6BC0', // 14 slate blue
  '#84831C', // 15 lime olive
  '#C2185B', // 16 magenta
  '#1F4E9E', // 17 navy
  '#C75B41', // 18 terracotta
  '#7E57C2', // 19 lavender
  '#2E7D52', // 20 forest
  '#2A78D6', // 21 blue
  '#06809C', // 22 forest teal
] as const;

// Colour for the i-th branch (alphabetical index). Wraps past 20 branches.
export function branchColorAt(i: number): string {
  return branchPalette[i % branchPalette.length];
}

// Keep upload categories client-safe. A use-server module cannot export plain constants.
export const documentCategories = [
  // onboarding
  'offer_letter',
  'contract',
  'joining_form',
  'id_proof',
  'education',
  'experience',
  'bank',
  'nda',
  'onboarding_other',
  // exit
  'resignation',
  'clearance',
  // anything else
  'other',
] as const;

export type DocumentCategory = (typeof documentCategories)[number];

// System-issued documents are verified when generated and cannot be replaced through upload forms.
// Reissue them from /exits. The experience category is shared with uploads, so use the
// bucket/source to distinguish an issued letter from an uploaded certificate.
export const generatedDocumentCategories = ['relieving', 'experience', 'settlement'] as const;

// Display names for every category, uploaded or issued.
export const documentCategoryLabels: Record<string, string> = {
  offer_letter: 'Offer letter',
  contract: 'Contract / agreement',
  joining_form: 'Joining form',
  id_proof: 'ID proof',
  education: 'Education',
  experience: 'Experience',
  bank: 'Bank details',
  nda: 'NDA / confidentiality',
  onboarding_other: 'Other onboarding',
  resignation: 'Resignation',
  clearance: 'Clearance / exit',
  other: 'Other',
  // Issued by HR (generatedDocumentCategories), so these two are display-only
  // — they are never offered in an upload form.
  relieving: 'Relieving letter',
  settlement: 'Full & final statement',
};

// Choose document labels by source so issued experience letters and uploaded certificates remain
// distinguishable.
export function documentCategoryLabel(category: string | null, issued = false): string {
  if (!category) {
    return '—';
  }
  if (issued && category === 'experience') {
    return 'Experience letter';
  }
  return documentCategoryLabels[category] ?? category;
}

// Required joining documents drive missing-document counts. Additional categories can be uploaded
// without being reported as missing.
export const requiredDocumentCategories: readonly string[] = [
  'offer_letter',
  'contract',
  'id_proof',
  'bank',
];

// Keep branch states in sync with the schema enum. Professional Tax is zero for states without
// configured pt_slabs.
export const States = [
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
  // Union territories (8) — the '// States (28)' count above covers only the
  // entries before this line.
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

// Portal navigation.

// Shared sidebar groups keep navigation labels and grouping consistent.
export const groups = {
  ATTENDANCE: 'Attendance',
  WORKFORCE: 'Workforce',
  HR: 'HR',
  RESOURCES: 'Resources',
  COMPANY: 'Company',
  ADMIN: 'Admin',
} as const;

export type NavGroup = (typeof groups)[keyof typeof groups];

// Render groups in this order and skip groups with no visible tabs.
export const groupOrder: NavGroup[] = [
  groups.ATTENDANCE,
  groups.WORKFORCE,
  groups.HR,
  groups.RESOURCES,
  groups.COMPANY,
  groups.ADMIN,
];

export interface NavItem {
  slug: string;
  label: string;
  group: NavGroup;
}

// Sidebar rows in group order. Keep Users and Import here so titles and access rules use the same
// slugs. Personal account settings belong in the profile menu.
export const navItems: NavItem[] = [
  { slug: 'today', label: 'Today', group: groups.ATTENDANCE },
  { slug: 'register', label: 'Monthly register', group: groups.ATTENDANCE },
  { slug: 'audit', label: 'Attendance audit', group: groups.ATTENDANCE },
  { slug: 'approvals', label: 'Approvals', group: groups.ATTENDANCE },
  { slug: 'tv', label: 'TV board', group: groups.ATTENDANCE },

  { slug: 'employees', label: 'Employees', group: groups.WORKFORCE },
  { slug: 'onboarding', label: 'Onboarding', group: groups.WORKFORCE },
  { slug: 'documents', label: 'Documents', group: groups.WORKFORCE },
  { slug: 'exits', label: 'Exits', group: groups.WORKFORCE },

  { slug: 'leave-management', label: 'Leave Management', group: groups.HR },
  { slug: 'leave', label: 'Leave salary', group: groups.HR },
  { slug: 'payroll', label: 'Payroll', group: groups.HR },
  { slug: 'reimbursements', label: 'Reimbursements', group: groups.HR },

  { slug: 'assets', label: 'Asset management', group: groups.RESOURCES },
  { slug: 'items', label: 'Inventory management', group: groups.RESOURCES },

  { slug: 'policies', label: 'Company policies', group: groups.COMPANY },
  { slug: 'holidays', label: 'Holidays', group: groups.COMPANY },
  { slug: 'notices', label: 'Notices', group: groups.COMPANY },
  { slug: 'helpdesk', label: 'Helpdesk', group: groups.COMPANY },

  { slug: 'users', label: 'Users', group: groups.ADMIN },
  { slug: 'import', label: 'Import', group: groups.ADMIN },
  { slug: 'settings', label: 'Settings', group: groups.ADMIN },
];

// Hide tabs unavailable to the role. Pages and actions enforce their own authorization checks.
export const tabRoleAccess: Record<string, readonly string[]> = {
  audit: ['super_admin', 'admin', 'hr'],
  onboarding: ['super_admin', 'admin', 'hr'],
  documents: ['super_admin', 'admin', 'hr'],
  exits: ['super_admin', 'admin', 'hr'],
  'leave-management': ['super_admin', 'admin', 'hr'],
  leave: ['super_admin', 'admin', 'hr'],
  assets: ['super_admin', 'admin', 'hr'],
  items: ['super_admin', 'admin', 'hr'],
  users: ['super_admin', 'admin', 'hr'],
  tv: ['super_admin', 'admin', 'hr'],
  import: ['super_admin', 'admin', 'hr'],
  settings: ['super_admin', 'admin', 'hr'],
};

// Static titles and fallback subtitles by slug. pageHeader supplies dates and counts from live
// data.
export const tabTitles: Record<string, [string, string]> = {
  today: ['Today', 'Live attendance · IST'],
  register: ['Monthly register', 'Attendance by month'],
  audit: ['Attendance audit', 'Who edited attendance & why'],
  'leave-management': ['Leave Management', 'Manage employee leave requests'],
  leave: ['Leave salary', '15-day paid leave & annual payout'],
  exits: ['Exits', 'Clearance, settlement & documents'],
  onboarding: ['Onboarding', 'Joiner checklists by owner'],
  documents: ['Documents', 'Employee document register'],
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
  import: ['Import', 'Bulk upload employees & attendance'],
  account: ['My account', 'Your profile & password'],
};

// Server-formatted dates keep topbar hydration consistent. Keep this client-safe contract outside
// the server-only queries module.
export interface TopbarStats {
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
export function pageHeader(slug: string, stats?: TopbarStats | null): [string, string] {
  const [title, fallback] = tabTitles[slug] ?? ['', ''];
  if (!stats) {
    return [title, fallback];
  }

  switch (slug) {
    case 'today':
      return [title, `${stats.todayLabel} · IST`];

    case 'register': {
      // A register reads as "closed" once its payroll can no longer be recomputed.
      const closed = stats.runStatus === 'locked' || stats.runStatus === 'paid';
      return [title, `${stats.periodLabel} · ${closed ? 'closed' : 'open'}`];
    }

    case 'payroll': {
      const status = stats.runStatus ? (runStatusLabel[stats.runStatus] ?? stats.runStatus) : null;
      return [title, `${stats.periodLabel} · ${status ?? 'no run yet'}`];
    }

    case 'employees': {
      if (stats.activeEmployees == null) {
        return [title, fallback];
      }
      const where = stats.branches.length ? ` · ${stats.branches.join(' & ')}` : '';
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
/**
 * Notice retention in days, shared by scheduled and on-publish cleanup. Delete notices older than
 * the IST cutoff, measured from published_at or created_at for drafts.
 */
export const noticeRetentionDays = 30;
