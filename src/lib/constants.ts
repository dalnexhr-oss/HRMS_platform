import type { AttendanceStatus } from '@/types/database';

// Status stamp metadata: [short label, css class, human label].
// Ported from attendanceStatusMeta in the prototype. 'S'/'T' reuse the outdoor-duty style.
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
  // Comp off. Reuses the holiday stamp style — a taken comp off
  // is a paid day off — rather than adding a class, so globals.css stays as
  // ported. Without this entry statusMeta() fell back to 'P' and a CO day
  // rendered as Present.
  CO: ['CO', 'st-OH', 'Comp off'],
};

export function statusMeta(s: AttendanceStatus | string) {
  return attendanceStatusMeta[s] ?? attendanceStatusMeta.P;
}

export const registerLegend: [AttendanceStatus, string][] = [
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

// Categorical palette for branch identity — the split bar and legend on /today and the branch chips on /employees. 20 fixed slots assigned by the branch's position in the (alphabetical) branch list, so a branch keeps its colour across both screens. The ORDER is deliberate, not cosmetic: it interleaves warm/cool hues so adjacent slots (which sit next to each other in the split bar) stay apart under colour-vision deficiency. Validated with the dataviz palette checker against the white card surface: lightness band, chroma floor and 3:1 contrast all pass; the one warn-band CVD pair (slots 6–7, mint↔red, deutan ΔE 6.2) is covered by secondary encoding — every legend row carries the branch name, and the split bar keeps 2px surface gaps between segments. Slot 1 stays in the Dalnex brand family. Don't re-order casually; re-run the validator if you do.
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
] as const;

// Colour for the i-th branch (alphabetical index). Wraps past 20 branches.
export function branchColorAt(i: number): string {
  return branchPalette[i % branchPalette.length];
}

// Document types offered when an employee files paperwork. Free text in the DB; this just keeps the drop-down tidy. It lives here rather than beside the upload action because that module is `'use server'`, and Next allows only async function exports from one — a plain const there fails the build.
export const documentCategories = [
  // --- onboarding
  'offer_letter',
  'contract',
  'joining_form',
  'id_proof',
  'education',
  'experience',
  'bank',
  'nda',
  'onboarding_other',
  // --- exit
  'resignation',
  'clearance',
  // --- anything else
  'other',
] as const;

export type DocumentCategory = (typeof documentCategories)[number];

// Categories the system ISSUES rather than accepts. generateExitDocument writes these into employee_documents itself, against the `generated-documents` bucket and already stamped verified — an HR-issued letter is authoritative the moment it is produced. They appear in the register alongside uploads but are never offered in an upload form, and nothing may replace one: reissuing means generating it again from /exits. NOTE the overlap: 'experience' is BOTH an uploadable category (the certificate from a previous employer) and the letter this company issues on exit. The category alone cannot tell them apart — the BUCKET can, which is why the register carries `source` and labels an issued row accordingly.
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

// The label to show for a row, given where its file came from. Only 'experience' needs the distinction — see the note on generatedDocumentCategories — but routing every row through one function means a future overlap is handled in one place rather than at each table.
export function documentCategoryLabel(category: string | null, issued = false): string {
  if (!category) return '—';
  if (issued && category === 'experience') return 'Experience letter';
  return documentCategoryLabels[category] ?? category;
}

// What every employee is expected to have on file. Drives the "missing" count on /documents and the gaps listed in an employee's drill-down. Deliberately short: it is the joining paperwork the company cannot operate without, not everything it might ever want. A category outside this list is welcome on file but never reported as missing.
export const requiredDocumentCategories: readonly string[] = [
  'offer_letter',
  'contract',
  'id_proof',
  'bank',
];

// Every Indian state and union territory a branch may be registered in. Must stay in lockstep with the `indian_state` — the branch form offers these and resolveBranch validates against them, but the database enum has the final word. Note on payroll: professional tax comes from pt_slabs, which only seeds Maharashtra and Gujarat. fn_professional_tax returns 0 when a state has no slab rows, so a branch in any other state computes PT as nil until its slabs are added.
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

//
// Portal navigation model
//

// Sidebar section headers. Declared as constants rather than typed inline on each row: a free-typed `group: 'Operations'` next to `group: 'Operate'` is how Import ended up alone under its own header, and the compiler could not see it. With NavItem['group'] bound to this object, the same slip is a build error. Each name states a domain ('Attendance', 'Company') rather than a frequency or a shrug — the old 'More' told the reader nothing, so every item under it had to be re-read on each visit.
export const groups = {
  ATTENDANCE: 'Attendance',
  WORKFORCE: 'Workforce',
  HR: 'HR',
  RESOURCES: 'Resources',
  COMPANY: 'Company',
  ADMIN: 'Admin',
} as const;

export type NavGroup = (typeof groups)[keyof typeof groups];

// Header order in the sidebar. The renderer walks this list, not NAV, and skips any group whose visible items come to zero — otherwise a role that cannot see Users, Import or Settings still gets a bare 'Admin' heading.
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

// Every sidebar row, in render order within its group. `users` and `import` were previously injected by Sidebar.tsx and absent from this list. That split is what let their group names drift, and why 'import' had no TabTitles row and no role gate. They are declared here now; Sidebar.tsx must no longer add them itself. 'My account' is deliberately absent — a personal profile is not navigation, and gating it alongside Users would have hidden it from the people who need it most. It belongs in the avatar menu beside Sign out.
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

  { slug: 'leaveManagment', label: 'Leave Management', group: groups.HR },
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

// Nav items only some roles may see. The page itself re-checks and redirects — this just avoids showing a link that would bounce. 'import' and 'settings' are new entries: both were reachable by every role because Sidebar.tsx injected Import outside this map, and Settings was simply never listed. A plain employee could open 'Rules & thresholds'.
export const TabRoleAuthorized: Record<string, readonly string[]> = {
  audit: ['super_admin', 'admin', 'hr'],
  onboarding: ['super_admin', 'admin', 'hr'],
  documents: ['super_admin', 'admin', 'hr'],
  exits: ['super_admin', 'admin', 'hr'],
  leaveManagment: ['super_admin', 'admin', 'hr'],
  leave: ['super_admin', 'admin', 'hr'],
  assets: ['super_admin', 'admin', 'hr'],
  items: ['super_admin', 'admin', 'hr'],
  users: ['super_admin', 'admin', 'hr'],
  tv: ['super_admin', 'admin', 'hr'],
  import: ['super_admin', 'admin', 'hr'],
  settings: ['super_admin', 'admin', 'hr'],
};

// Page titles + FALLBACK subtitles keyed by slug. These are deliberately plain
// descriptions: anything carrying a live figure (today's date, the current
// period, head-counts, pending queues) is filled in by pageHeader() from real
// data, so a stale number is never invented here. The prototype's hardcoded
// "Wednesday, 8 July 2026", "45 active" and "2 pending" used to live in this map.
export const TabTitles: Record<string, [string, string]> = {
  today: ['Today', 'Live attendance · IST'],
  register: ['Monthly register', 'Attendance by month'],
  audit: ['Attendance audit', 'Who edited attendance & why'],
  leaveManagment: ['Leave Management', 'Manage employee leave requests'],
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

// Live figures behind the topbar subtitles, resolved by the portal layout (see getTopbarStats). Date labels are pre-formatted on the SERVER so the client cannot hydrate a different day. The interface lives here rather than in queries.ts so the client-side Topbar can import it without dragging a server-only module into the browser bundle.
export interface TopbarStats {
  // e.g. 'Saturday, 25 July 2026' — today in the business timezone.
  todayLabel: string;
  // e.g. 'July 2026' — the current payroll period.
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

// Title + subtitle for a page. Falls back to the static TabTitles row whenever the figure behind a subtitle is unavailable, so a failed count degrades to a plain description rather than to a wrong number.
export function pageHeader(slug: string, stats?: TopbarStats | null): [string, string] {
  const [title, fallback] = TabTitles[slug] ?? ['', ''];
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
      const status = stats.runStatus ? runStatusLabel[stats.runStatus] ?? stats.runStatus : null;
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
/**
 * How long a notice is kept before it is DELETED.
 *
 * Deletion, not hiding: deleteExpiredNotices() in db/scheduler.ts measures this
 * many days back from today (IST) and removes every notice published — or, for
 * a draft, created — before that cutoff. Notices carry no expiry column and
 * nothing filters them at render time; the row is simply gone.
 *
 * ONE number, because there used to be two. The nightly job defaulted to 90
 * days while the purge that runs whenever staff publish used 30, and since the
 * 30-day sweep always ran first, everything older was already gone by the time
 * the 90-day job looked. Both callers now default to this constant.
 */
export const noticeRetentionDays = 30;
