// ============================================================================
// Database types for the Dalnex HRMS schema.
// In a real project regenerate with:
//   supabase gen types typescript --local > src/types/database.ts
// This hand-written version mirrors supabase/migrations and is the source of
// truth for the typed Supabase client until you wire up generation.
// ============================================================================

// 'CO' (comp off) was added to the DB enum in migration 0006 but never mirrored
// here, so a comp-off day had no type-level existence (and statusMeta fell back
// to rendering it as 'P'). Migration 0009 makes it a first-class feature.
export type AttendanceStatus = 'P' | 'LM' | 'HD' | 'L' | 'WO' | 'OH' | 'AB' | 'S' | 'T' | 'CO';
export type Gender = 'Male' | 'Female' | 'Other';
export type EmployeeStatus = 'active' | 'on_notice' | 'inactive';
export type IndianState = 'Maharashtra' | 'Gujarat';
export type RequestType = 'leave' | 'site_visit' | 'outdoor_duty' | 'wfh' | 'comp_off';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveType = 'PL' | 'CL' | 'SL' | 'LWP';
export type PayrollStatus = 'draft' | 'in_review' | 'locked' | 'paid';
export type PayslipStatus = 'draft' | 'queued' | 'generated' | 'paid';
export type NoticeChannel = 'app' | 'whatsapp' | 'both';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type AppRole = 'admin' | 'hr' | 'manager' | 'viewer' | 'employee';
export type ReimbursementPurpose = 'travel' | 'material_purchase' | 'other';
export type ReimbursementStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type CompOffStatus = 'available' | 'applied' | 'used' | 'expired';

export interface Branch {
  id: string;
  name: string;
  state: IndianState;
  address: string | null;
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number;
  created_at: string;
}

export interface Department {
  id: string;
  name: string;
  branch_id: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: AppRole;
  branch_id: string | null;
  employee_id: string | null;
  avatar: string | null;
  created_at: string;
}

export interface Policy {
  id: string;
  title: string;
  category: string | null;
  body: string;
  version: number;
  effective_date: string | null;
  branch_id: string | null;
  published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyAcknowledgement {
  id: string;
  policy_id: string;
  employee_id: string;
  acknowledged_at: string;
}

export interface Employee {
  id: string;
  code: string;
  full_name: string;
  branch_id: string;
  department_id: string | null;
  designation: string | null;
  gender: Gender;
  date_of_joining: string;
  date_of_birth: string | null;
  whatsapp: string | null;
  email: string | null;
  pan: string | null;
  pf_uan: string | null;
  esic_number: string | null;
  gross_monthly: number;
  basic_da: number;
  hra: number;
  special_allowance: number;
  status: EmployeeStatus;
  created_at: string;
  updated_at: string;
}

export interface AttendanceDay {
  id: string;
  employee_id: string;
  work_date: string;
  status: AttendanceStatus;
  punch_in: string | null;
  punch_out: string | null;
  worked_minutes: number;
  is_corrected: boolean;
  correction_reason: string | null;
  corrected_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Holiday {
  id: string;
  holiday_date: string;
  name: string;
  branch_id: string | null;
  created_at: string;
}

export interface RequestRow {
  id: string;
  employee_id: string;
  type: RequestType;
  leave_kind: LeaveType | null;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: RequestStatus;
  balance_after: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface PayrollRun {
  id: string;
  period_month: string;
  status: PayrollStatus;
  working_days: number | null;
  target_minutes: number | null;
  month_closed_at: string | null;
  drafts_computed_at: string | null;
  adjustments_open: string | null;
  adjustments_close: string | null;
  locked_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  payable_days: number;
  worked_minutes: number;
  target_minutes: number;
  shortfall_minutes: number;
  per_day_rate: number;
  basic_earned: number;
  hra_earned: number;
  special_earned: number;
  earned_gross: number;
  shortfall_amount: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  professional_tax: number;
  net_payable: number;
  status: PayslipStatus;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  actor_id: string | null;
  employee_id: string | null;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface Notice {
  id: string;
  title: string;
  body: string | null;
  pdf_url: string | null;
  channel: NoticeChannel;
  branch_id: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface HelpdeskTicket {
  id: string;
  employee_id: string | null;
  subject: string;
  body: string | null;
  category: string | null;
  status: TicketStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface ReimbursementClaim {
  id: string;
  employee_id: string;
  claim_date: string;
  description: string;
  purpose: ReimbursementPurpose;
  source_medium: string | null;
  kms: number | null;
  mode_of_payment: string | null;
  amount: number;
  remarks: string | null;
  status: ReimbursementStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface CompOff {
  id: string;
  employee_id: string;
  earned_date: string;
  status: CompOffStatus;
  used_date: string | null;
  request_id: string | null;
  granted_by: string | null;
  created_at: string;
}

export interface AppSetting {
  key: string;
  value: unknown;
  label: string | null;
  description: string | null;
  branch_id: string | null;
  updated_at: string;
}
