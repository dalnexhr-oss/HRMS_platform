// ============================================================================
// Collection registry and document shapes. SERVER ONLY.
//
// One place that knows what every collection is called, so a rename is a single
// edit rather than a grep across 327 call sites. Names match the old Postgres
// table names exactly — that keeps the port mechanical and makes it obvious
// which migration defined each one.
//
// Only `users` is modelled so far; the rest are listed because the registry is
// the thing later phases fill in, and an empty gap is easier to see than a
// missing constant.
// ============================================================================
import type { Collection, Decimal128, Document } from 'mongodb';
import { db } from '@/lib/db/mongo';
import type { AppRole } from '@/types/database';

export const COLLECTIONS = {
  // --- identity -------------------------------------------------------------
  /**
   * Supabase kept auth.users (GoTrue) and public.profiles as two tables joined
   * on id. There is no separate auth schema any more, so they are one document:
   * credentials, role and per-tab access together.
   */
  users: 'users',

  // --- org ------------------------------------------------------------------
  branches: 'branches',
  departments: 'departments',
  employees: 'employees',

  // --- attendance -----------------------------------------------------------
  punchEvents: 'punch_events',
  attendanceDays: 'attendance_days',
  lateMarks: 'late_marks',
  holidays: 'holidays',

  // --- leave ----------------------------------------------------------------
  requests: 'requests',
  approvalSteps: 'approval_steps',
  leaveBalances: 'leave_balances',
  leaveBalanceAdjustments: 'leave_balance_adjustments',
  compOffs: 'comp_offs',
  leaveEncashment: 'leave_encashment',
  leaveSalaryWorkings: 'leave_salary_workings',

  // --- payroll --------------------------------------------------------------
  payrollRuns: 'payroll_runs',
  payslips: 'payslips',
  payslipAdjustments: 'payslip_adjustments',
  ptSlabs: 'pt_slabs',

  // --- assets and items -----------------------------------------------------
  assets: 'assets',
  assetAssignments: 'asset_assignments',
  assetMaintenance: 'asset_maintenance',
  items: 'items',
  itemAssignments: 'item_assignments',

  // --- documents and comms --------------------------------------------------
  employeeDocuments: 'employee_documents',
  notices: 'notices',
  noticeReads: 'notice_reads',
  policies: 'policies',
  policyAcknowledgements: 'policy_acknowledgements',
  acknowledgements: 'acknowledgements',
  notifications: 'notifications',
  helpdeskTickets: 'helpdesk_tickets',
  helpdeskTicketComments: 'helpdesk_ticket_comments',

  // --- lifecycle ------------------------------------------------------------
  onboardingTemplates: 'onboarding_templates',
  onboardingTemplateItems: 'onboarding_template_items',
  onboardingTasks: 'onboarding_tasks',
  exitCases: 'exit_cases',
  exitClearanceItems: 'exit_clearance_items',
  exitInterviews: 'exit_interviews',
  knowledgeTransferItems: 'knowledge_transfer_items',
  fullAndFinal: 'full_and_final',

  // --- reimbursements -------------------------------------------------------
  reimbursementClaims: 'reimbursement_claims',
  reimbursementEvents: 'reimbursement_events',

  // --- system ---------------------------------------------------------------
  settings: 'settings',
  activityLog: 'activity_log',
  cronRunLog: 'cron_run_log',
  /** Per-ROLE tab access. The per-USER map is embedded as users.tab_access. */
  roleTabAccess: 'role_tab_access',
  /** Auth-owned; read through lib/auth/reset-tokens.ts, never the repository. */
  passwordResetTokens: 'password_reset_tokens',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/**
 * The shape every document here shares: a UUID STRING primary key.
 *
 * The driver's default `Document` assumes `_id: ObjectId`, which is wrong for
 * this database — keys were carried over from Postgres unchanged so that every
 * existing foreign-key value stays valid. Use this wherever a collection has no
 * specific interface yet, rather than casting at each call site.
 */
export interface BaseDoc {
  _id: string;
  [key: string]: unknown;
}

/**
 * A signed-in account. Merges what used to be auth.users + public.profiles +
 * public.user_tab_access.
 *
 * `_id` is the same UUID string the Postgres schema used, so every existing
 * foreign key value (employees.corrected_by, activity_log.actor, …) stays valid
 * without rewriting.
 */
export interface UserDoc {
  _id: string;

  /** Lowercased at write time; the unique index is the real guarantee. */
  email: string;
  /** scrypt, encoded by lib/auth/password.ts. Never leaves the server. */
  password_hash: string;

  full_name: string | null;
  role: AppRole;
  branch_id: string | null;
  /** Preset avatar key from lib/avatar-presets.ts. */
  avatar: string | null;

  /** Links to the employees collection. Null for staff with no employee record. */
  employee_id: string | null;

  /**
   * Replaces the GoTrue "ban" flag. Checked on every request, so switching it on
   * locks the account out immediately even though the cookie is still valid.
   */
  disabled: boolean;

  /**
   * Bumped to revoke every session this account holds. A JWT cannot be recalled
   * once issued, and these are long-lived, so this counter is what makes sign
   * out, password change and "disable login" actually take effect.
   */
  token_version: number;

  /** Per-tab access. An absent key means allowed. */
  tab_access: Record<string, boolean>;

  email_verified_at: Date | null;
  last_sign_in_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** What is safe to hand to a React component. Never includes the hash. */
export type PublicUser = Omit<UserDoc, 'password_hash' | 'token_version'>;

/** Strip server-only fields before a document crosses into rendering. */
export function toPublicUser(user: UserDoc): PublicUser {
  const { password_hash: _hash, token_version: _v, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// Org core
// ---------------------------------------------------------------------------

/**
 * A calendar day, as "YYYY-MM-DD".
 *
 * NOT a BSON Date. Postgres `date` is a calendar day; BSON Date is a UTC
 * instant. In IST (+05:30) a round trip through Date moves a day boundary, so
 * an attendance row or a joining date lands on the wrong day. Strings sort and
 * range-query correctly and cannot drift.
 */
export type DateOnly = string;

/** A time of day, as "HH:MM". BSON has no time type at all. */
export type TimeOnly = string;

export interface BranchDoc {
  _id: string;
  /** Unique, case-insensitively — the index enforces it. */
  name: string;
  state: string;
  address: string | null;
  /** Geofence classifies a punch as on-site or remote; it never blocks one. */
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number;
  created_at: Date;
}

export interface DepartmentDoc {
  _id: string;
  name: string;
  branch_id: string | null;
  created_at: Date;
}

/** Mirrors the employee_status enum. 'on_notice' is a serving-notice employee. */
export type EmployeeStatus = 'active' | 'on_notice' | 'inactive';

export interface EmployeeDoc {
  _id: string;
  /** 'DN001'. Unique. */
  code: string;
  full_name: string;

  branch_id: string;
  department_id: string | null;
  /**
   * Denormalised from branches/departments.
   *
   * Almost every list screen reads a row alongside its branch name, and the old
   * PostgREST queries did that with an embedded select — a join per read. Names
   * change once a year and are read constantly, so they are copied here and
   * refreshed when a branch or department is renamed. This is the single change
   * that removes most of the join work from the port.
   */
  branch_name: string | null;
  department_name: string | null;

  designation: string | null;
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

  /**
   * Salary, monthly, INR. Decimal128 — never a JS number.
   * gross_monthly must equal basic_da + hra + special_allowance; that was a
   * CHECK constraint (`salary_components_sum`) and is now enforced in the
   * employee actions with lib/db/money.ts.
   */
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

/** Typed handle for an arbitrary collection. */
export async function collection<T extends Document>(
  name: CollectionName,
): Promise<Collection<T>> {
  return (await db()).collection<T>(name);
}

/**
 * Typed handle for the users collection.
 *
 * UNSCOPED — this is the auth layer's own handle, used before a session exists
 * (sign-in must read a user nobody is yet signed in as). Application code that
 * lists or edits accounts goes through lib/db/repo.ts instead.
 */
export async function usersCollection(): Promise<Collection<UserDoc>> {
  return (await db()).collection<UserDoc>(COLLECTIONS.users);
}
