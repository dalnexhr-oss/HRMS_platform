// Collection registry and schema document interfaces. SERVER ONLY.
//
// Centralizes collection name constants and type definitions for entities
// including identity, org hierarchy, attendance, leave, payroll, and assets.
//
import type { Collection, Decimal128, Document } from 'mongodb';
import { db } from '@/lib/db/mongo';
import type { AppRole } from '@/types/database';
// import type { EmploymentType} from '@/types/database';
export const collections = {
  // --- identity
  // Consolidated identity document: authentication credentials, role, and tab access permissions.
  users: 'users',

  // --- org
  branches: 'branches',
  departments: 'departments',
  employees: 'employees',

  // --- attendance
  punchEvents: 'punch_events',
  attendanceDays: 'attendance_days',
  lateMarks: 'late_marks',
  holidays: 'holidays',

  // --- leave
  requests: 'requests',
  approvalSteps: 'approval_steps',
  leaveBalances: 'leave_balances',
  leaveBalanceAdjustments: 'leave_balance_adjustments',
  compOffs: 'comp_offs',
  leaveEncashment: 'leave_encashment',
  leaveSalaryWorkings: 'leave_salary_workings',

  // --- payroll
  payrollRuns: 'payroll_runs',
  payslips: 'payslips',
  payslipAdjustments: 'payslip_adjustments',
  ptSlabs: 'pt_slabs',

  // --- assets and items
  assets: 'assets',
  assetAssignments: 'asset_assignments',
  assetMaintenance: 'asset_maintenance',
  items: 'items',
  itemAssignments: 'item_assignments',

  // --- documents and comms
  employeeDocuments: 'employee_documents',
  notices: 'notices',
  noticeReads: 'notice_reads',
  policies: 'policies',
  policyAcknowledgements: 'policy_acknowledgements',
  acknowledgements: 'acknowledgements',
  notifications: 'notifications',
  helpdeskTickets: 'helpdesk_tickets',
  helpdeskTicketComments: 'helpdesk_ticket_comments',

  // --- lifecycle
  onboardingTemplates: 'onboarding_templates',
  onboardingTemplateItems: 'onboarding_template_items',
  onboardingTasks: 'onboarding_tasks',
  exitCases: 'exit_cases',
  exitClearanceItems: 'exit_clearance_items',
  exitInterviews: 'exit_interviews',
  knowledgeTransferItems: 'knowledge_transfer_items',
  fullAndFinal: 'full_and_final',

  // --- reimbursements
  reimbursementClaims: 'reimbursement_claims',
  reimbursementEvents: 'reimbursement_events',

  // --- system
  settings: 'settings',
  activityLog: 'activity_log',
  cronRunLog: 'cron_run_log',
  // Per-ROLE tab access. The per-USER map is embedded as users.tab_access.
  roleTabAccess: 'role_tab_access',
  // Auth-owned; read through lib/auth/reset-tokens.ts, never the repository.
  passwordResetTokens: 'password_reset_tokens',
} as const;

export type CollectionName = (typeof collections)[keyof typeof collections];

// Base document interface with UUID string primary key (_id).
export interface BaseDoc {
  _id: string;
  [key: string]: unknown;
}

// Authenticated user account document, including credentials, role assignment, and access controls.
export interface UserDoc {
  _id: string;

  // Lowercased at write time; the unique index is the real guarantee.
  email: string;
  // scrypt, encoded by lib/auth/password.ts. Never leaves the server.
  password_hash: string;

  full_name: string | null;
  role: AppRole;
  branch_id: string | null;
  // Preset avatar key from lib/avatar-presets.ts.
  avatar: string | null;

  // Links to the employees collection. Null for staff with no employee record.
  employee_id: string | null;

  // When true, immediately denies authentication even if JWT session cookie is unexpired.
  disabled: boolean;

  // Monotonically incremented to invalidate existing issued sessions upon logout or password reset.
  token_version: number;

  // Per-tab access. An absent key means allowed.
  tab_access: Record<string, boolean>;

  email_verified_at: Date | null;
  last_sign_in_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// What is safe to hand to a React component. Never includes the hash.
export type PublicUser = Omit<UserDoc, 'password_hash' | 'token_version'>;

// Strip server-only fields before a document crosses into rendering.
export function toPublicUser(user: UserDoc): PublicUser {
  const { password_hash: _hash, token_version: _v, ...rest } = user;
  return rest;
}

//
// Org core
//

// Calendar date represented as ISO-8601 string ("YYYY-MM-DD") to avoid timezone shift on day boundaries.
export type DateOnly = string;

// A time of day, as "HH:MM". BSON has no time type at all.
export type TimeOnly = string;

export interface BranchDoc {
  _id: string;
  // Unique, case-insensitively — the index enforces it.
  name: string;
  state: string;
  address: string | null;
  // Office location coordinates for geofence classification. Null values fall back
  // to global settings. Stored as 6-decimal Decimal128.
  geofence_lat: Decimal128 | null;
  geofence_lng: Decimal128 | null;
  // Radius in metres (default: 150).
  geofence_radius_m: number;
  created_at: Date;
}

export interface DepartmentDoc {
  _id: string;
  name: string;
  branch_id: string | null;
  created_at: Date;
}

// Lifecycle status for employee records.
export type EmployeeStatus = 'active' | 'on_notice' | 'inactive';

export interface EmployeeDoc {
  _id: string;
  // 'DN001'. Unique.
  code: string;
  full_name: string;

  branch_id: string;
  department_id: string | null;
  // Denormalized name from branch/department documents; updated synchronously upon rename.
  branch_name: string | null;
  department_name: string | null;

  designation: string | null;
  // Payroll classification ('employee' | 'intern'). Defaults to 'employee'.
  // employment_type?: EmploymentType;
  gender: string;
  date_of_joining: DateOnly;
  date_of_birth: DateOnly | null;

  // contact
  whatsapp: string | null;
  email: string | null;
  email_official: string | null;
  email_personal: string | null;
  mobile_official: string | null;
  mobile_personal: string | null;

  // statutory identifiers
  pan: string | null;
  pf_uan: string | null;
  esic_number: string | null;
  aadhaar: string | null;

  // bank
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;

  // emergency contact
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;

  // Monthly salary components in INR, stored as Decimal128.
  // Invariant: gross_monthly must equal basic_da + hra + special_allowance.
  gross_monthly: Decimal128;
  basic_da: Decimal128;
  hra: Decimal128;
  special_allowance: Decimal128;

  // exit
  resignation_date: DateOnly | null;
  last_working_day: DateOnly | null;
  notice_period_days: number | null;
  exit_reason: string | null;

  status: EmployeeStatus;
  created_at: Date;
  updated_at: Date;
}

// Typed handle for an arbitrary collection.
export async function collection<T extends Document>(
  name: CollectionName,
): Promise<Collection<T>> {
  return (await db()).collection<T>(name);
}

// Direct collection handle for user identity queries during unauthenticated sign-in flows.
export async function usersCollection(): Promise<Collection<UserDoc>> {
  return (await db()).collection<UserDoc>(collections.users);
}
