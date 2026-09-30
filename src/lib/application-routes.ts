// Page URLs use lowercase, descriptive names. Employee pages share one namespace.
const routes = {
  dashboard: '/dashboard',
  employee: '/employee',
  employeeAccount: '/employee/account',
  employeeApprovals: '/employee/approvals',
  monthlyRegister: '/monthly-register',
  attendanceAudit: '/attendance-audit',
  tvDashboard: '/tv-dashboard',
  leaveSalary: '/leave-salary',
  assetManagement: '/asset-management',
  inventoryManagement: '/inventory-management',
  companyPolicies: '/company-policies',
  dataImport: '/data-import',
  resetPassword: '/auth/reset-password',
  tvDashboardApi: '/api/tv-dashboard',
} as const;

export { routes };
