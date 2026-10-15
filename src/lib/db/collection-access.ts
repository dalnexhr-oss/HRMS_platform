import { canAccessTab } from '@/lib/portal-access';
import type { Scope } from '@/lib/db/access-scope';

// Shared reference data is readable by every signed-in account; domain records require a tab
// which actually consumes them. Employee ownership remains enforced by the collection policy.
const domains: Record<string, readonly string[]> = {
  users: ['users'],
  employees: [
    'employees',
    'onboarding',
    'documents',
    'exits',
    'monthly-register',
    'attendance-audit',
    'dashboard',
    'tv-dashboard',
    'payroll',
    'professional-tax',
    'leave-salary',
    'approvals',
    'leave-management',
    'reimbursements',
    'asset-management',
    'inventory-management',
    'data-import',
  ],
  punch_events: ['dashboard', 'monthly-register', 'attendance-audit', 'tv-dashboard'],
  attendance_days: [
    'dashboard',
    'monthly-register',
    'attendance-audit',
    'tv-dashboard',
    'payroll',
    'leave-salary',
    'approvals',
    'leave-management',
    'data-import',
  ],
  late_marks: ['dashboard', 'monthly-register', 'attendance-audit'],
  requests: ['approvals', 'leave-management', 'monthly-register', 'dashboard', 'tv-dashboard'],
  approval_steps: ['approvals', 'leave-management'],
  leave_balances: ['leave-salary', 'leave-management', 'approvals'],
  leave_balance_adjustments: ['leave-salary'],
  comp_offs: ['dashboard', 'approvals', 'leave-management', 'monthly-register'],
  leave_encashment: ['leave-salary', 'exits'],
  leave_salary_workings: ['leave-salary'],
  payroll_runs: [
    'payroll',
    'monthly-register',
    'attendance-audit',
    'dashboard',
    'reimbursements',
    'data-import',
    'approvals',
  ],
  payslips: ['payroll', 'professional-tax'],
  payslip_adjustments: ['payroll', 'professional-tax'],
  pt_slabs: ['professional-tax', 'payroll'],
  assets: ['asset-management', 'exits'],
  asset_assignments: ['asset-management', 'exits'],
  asset_maintenance: ['asset-management'],
  items: ['inventory-management', 'exits'],
  item_assignments: ['inventory-management', 'exits'],
  employee_documents: ['documents', 'onboarding'],
  notices: ['notices', 'dashboard'],
  notice_reads: ['notices'],
  policies: ['company-policies'],
  policy_acknowledgements: ['company-policies'],
  acknowledgements: ['documents', 'onboarding', 'company-policies'],
  helpdesk_tickets: ['helpdesk'],
  helpdesk_ticket_comments: ['helpdesk'],
  onboarding_templates: ['onboarding'],
  onboarding_template_items: ['onboarding'],
  onboarding_tasks: ['onboarding'],
  exit_cases: ['exits', 'documents'],
  exit_clearance_items: ['exits'],
  exit_interviews: ['exits'],
  knowledge_transfer_items: ['exits'],
  full_and_final: ['exits'],
  reimbursement_claims: ['reimbursements', 'exits'],
  reimbursement_events: ['reimbursements'],
  role_tab_access: ['users'],
  activity_log: ['attendance-audit', 'dashboard'],
  cron_run_log: ['dashboard', 'attendance-audit'],
};

const writeTabs: Record<string, readonly string[]> = {
  employees: ['employees', 'exits', 'onboarding'],
  attendance_days: ['monthly-register', 'data-import', 'approvals'],
  payslips: ['payroll'],
  payslip_adjustments: ['payroll', 'reimbursements'],
  settings: ['settings'],
  branches: ['settings', 'employees'],
  departments: ['settings', 'employees'],
  holidays: ['holidays'],
  notices: ['notices'],
  requests: ['approvals', 'leave-management'],
  activity_log: [], // Audit writes accompany any authorized business operation.
};

function mayAccessCollection(scope: Scope, name: string, write = false): boolean {
  if (scope.isSystem || !scope.isStaff) {
    return true;
  }
  const tabs = (write ? writeTabs[name] : undefined) ?? domains[name];
  return (
    !tabs ||
    tabs.length === 0 ||
    tabs.some((tab) => canAccessTab(scope.role, tab, scope.tabAccess ?? {}))
  );
}

export { mayAccessCollection };
