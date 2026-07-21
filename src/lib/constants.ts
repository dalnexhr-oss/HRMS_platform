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
};

// Page titles + subtitles keyed by slug (ported from TITLES).
export const TITLES: Record<string, [string, string]> = {
  today: ['Today', 'Wednesday, 8 July 2026 · IST'],
  register: ['Monthly register', 'June 2026 · closed'],
  payroll: ['Payroll', 'June 2026 · in review — locks Fri 10 Jul'],
  reimbursements: ['Reimbursements', 'Expense claims · approve & pay'],
  employees: ['Employees', '45 active · Pune & Vadodara'],
  policies: ['Company policies', 'Published to employee dashboards'],
  approvals: ['Approvals', '2 pending'],
  holidays: ['Holidays', '2026 calendar'],
  notices: ['Notices', 'Policy bulletin'],
  helpdesk: ['Helpdesk', 'Employee tickets'],
  settings: ['Settings', 'Rules & thresholds'],
  users: ['Users', 'Login accounts & roles'],
  account: ['My account', 'Your profile & password'],
};
