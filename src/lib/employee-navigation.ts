// Employee self-service navigation. Mirrors portal-navigation.ts so both sidebars share one shape.
import { routes } from '@/lib/application-routes';

const employeeGroups = {
  OVERVIEW: 'Overview',
  ATTENDANCE: 'Attendance',
  PAY: 'Pay',
  RECORDS: 'My records',
  COMPANY: 'Company',
} as const;

type EmployeeNavGroup = (typeof employeeGroups)[keyof typeof employeeGroups];

// Render groups in this order: daily tasks first, reference material last.
const employeeGroupOrder: EmployeeNavGroup[] = [
  employeeGroups.OVERVIEW,
  employeeGroups.ATTENDANCE,
  employeeGroups.PAY,
  employeeGroups.RECORDS,
  employeeGroups.COMPANY,
];

interface EmployeeNavItem {
  // Path segment under /employee; '' is the dashboard itself.
  slug: string;
  label: string;
  group: EmployeeNavGroup;
  // Key into components/Icons.tsx.
  icon: string;
}

// Sidebar rows in group order. Account settings belong in the profile menu, as in the portal.
const employeeNavItems: EmployeeNavItem[] = [
  { slug: '', label: 'Dashboard', group: employeeGroups.OVERVIEW, icon: 'dashboard' },
  { slug: 'approvals', label: 'Approvals', group: employeeGroups.OVERVIEW, icon: 'approvals' },

  {
    slug: 'attendance',
    label: 'Attendance',
    group: employeeGroups.ATTENDANCE,
    icon: 'employee-attendance',
  },
  {
    slug: 'leave',
    label: 'Leave & requests',
    group: employeeGroups.ATTENDANCE,
    icon: 'leave-management',
  },
  {
    slug: 'comp-offs',
    label: 'Comp offs',
    group: employeeGroups.ATTENDANCE,
    icon: 'employee-comp-offs',
  },
  {
    slug: 'holidays',
    label: 'Holidays',
    group: employeeGroups.ATTENDANCE,
    icon: 'holidays',
  },

  { slug: 'payslips', label: 'Payslips', group: employeeGroups.PAY, icon: 'payroll' },
  {
    slug: 'reimbursements',
    label: 'Reimbursements',
    group: employeeGroups.PAY,
    icon: 'reimbursements',
  },

  {
    slug: 'documents',
    label: 'Documents',
    group: employeeGroups.RECORDS,
    icon: 'employee-documents',
  },
  { slug: 'onboarding', label: 'Onboarding', group: employeeGroups.RECORDS, icon: 'onboarding' },
  {
    slug: 'assets',
    label: 'Assets & items',
    group: employeeGroups.RECORDS,
    icon: 'asset-management',
  },

  {
    slug: 'policies',
    label: 'Company policies',
    group: employeeGroups.COMPANY,
    icon: 'company-policies',
  },
  { slug: 'helpdesk', label: 'Helpdesk', group: employeeGroups.COMPANY, icon: 'helpdesk' },
];

// Topbar title and subtitle by slug.
const employeeTabTitles: Record<string, [string, string]> = {
  '': ['Dashboard', 'Your month at a glance'],
  approvals: ['Approvals', 'Requests sent to you'],
  attendance: ['Attendance', 'Punch clock & monthly record'],
  leave: ['Leave & requests', 'Leave, duty & work-from-home requests'],
  'comp-offs': ['Comp offs', 'Earned for working an off day'],
  holidays: ['Holidays', 'Holiday calendar & weekly offs'],
  payslips: ['Payslips', 'Monthly salary statements'],
  reimbursements: ['Reimbursements', 'Expense claims'],
  documents: ['Documents', 'Your document locker'],
  onboarding: ['Onboarding', 'Joining checklist'],
  assets: ['Assets & items', 'Equipment assigned to you'],
  policies: ['Company policies', 'Read & acknowledge'],
  helpdesk: ['Helpdesk', 'Your support tickets'],
  account: ['My account', 'Your profile & password'],
};

function employeeHref(slug: string): string {
  return slug ? `${routes.employee}/${slug}` : routes.employee;
}

// Slug for the current employee pathname: '/employee/leave' -> 'leave', '/employee' -> ''.
function employeeSlugFromPathname(pathname: string): string {
  const [area, slug] = pathname.split('/').filter(Boolean);
  return area === 'employee' ? (slug ?? '') : '';
}

// Maps section shortcuts (such as #payslips in notification emails) to the dedicated tab for that feature.
const employeeSectionSlugs: Readonly<Record<string, string>> = {
  punch: 'attendance',
  attendance: 'attendance',
  leave: 'leave',
  'comp-offs': 'comp-offs',
  holidays: 'holidays',
  payslips: 'payslips',
  reimbursements: 'reimbursements',
  documents: 'documents',
  onboarding: 'onboarding',
  assets: 'assets',
  items: 'assets',
  policies: 'policies',
  tickets: 'helpdesk',
};

// Redirects shortcut links from emails or notifications to their target employee tab.
function resolveEmployeeLink(
  path: string,
  hash: string | null,
): { path: string; hash: string | null } {
  if (path !== routes.employee || !hash) {
    return { path, hash };
  }
  const slug = employeeSectionSlugs[hash];
  return slug === undefined ? { path, hash } : { path: employeeHref(slug), hash };
}

export {
  employeeGroupOrder,
  employeeNavItems,
  employeeTabTitles,
  employeeHref,
  employeeSlugFromPathname,
  employeeSectionSlugs,
  resolveEmployeeLink,
};

export type { EmployeeNavGroup, EmployeeNavItem };
