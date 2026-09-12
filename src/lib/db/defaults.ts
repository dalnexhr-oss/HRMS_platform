//
// The value each field takes when an insert omits it. Maintained by hand.
//
// Postgres applied a column DEFAULT when an INSERT omitted it; MongoDB has no
// such notion, so every ported insert that relied on one was writing an
// incomplete document — and where the field is also required, the collection
// validator rejects the write outright as error 121.
//
// This table was first generated from the DDL's DEFAULT clauses; that SQL and
// its generator are gone, so it is now edited directly. When you add a field
// that needs a default, add it here too, and give it the BSON type the
// validator in scripts/schema.generated.mjs declares — money must be
// Decimal128, not a bare number, or the insert fails validation.
//
import { Decimal128 } from 'mongodb';

// Marker for `now()` — resolved per insert, never at module load.
export const now = Symbol('now');
// Marker for `current_date` — an IST calendar date, as `YYYY-MM-DD`.
export const today = Symbol('today');

const money = (v: string): Decimal128 => Decimal128.fromString(v);

export type DefaultValue = string | number | boolean | Decimal128 | object | symbol;

// collection -> field -> the value Postgres would have supplied.
export const columnDefaults: Record<string, Record<string, DefaultValue>> = {
  acknowledgements: {
    signed_at: now,
  },
  activity_log: {
    metadata: {},
    occurred_at: now,
  },
  approval_steps: {
    status: "pending",
    created_at: now,
  },
  asset_assignments: {
    assigned_date: today,
    returned: false,
    created_at: now,
  },
  asset_maintenance: {
    maint_date: today,
    created_at: now,
  },
  assets: {
    created_at: now,
    updated_at: now,
  },
  attendance_days: {
    worked_minutes: 0,
    is_corrected: false,
    created_at: now,
    updated_at: now,
  },
  branches: {
    geofence_radius_m: 150,
    created_at: now,
  },
  comp_offs: {
    status: "available",
    created_at: now,
    is_applicable: true,
  },
  cron_run_log: {
    ran_at: now,
  },
  employee_documents: {
    uploaded_at: now,
    bucket: "employee-documents",
  },
  employees: {
    employment_type: "employee",
    gross_monthly: money('0.00'),
    basic_da: money('0.00'),
    hra: money('0.00'),
    special_allowance: money('0.00'),
    status: "active",
    created_at: now,
    updated_at: now,
  },
  exit_cases: {
    stage: "initiated",
    created_at: now,
    updated_at: now,
  },
  exit_clearance_items: {
    cleared: false,
    created_at: now,
  },
  exit_interviews: {
    created_at: now,
  },
  full_and_final: {
    salary_payable: money('0.00'),
    leave_encashment: money('0.00'),
    pending_reimbursements: money('0.00'),
    asset_recovery: money('0.00'),
    other_deductions: money('0.00'),
    net_payable: money('0.00'),
    status: "draft",
    created_at: now,
    updated_at: now,
  },
  helpdesk_ticket_comments: {
    author_is_staff: false,
    created_at: now,
  },
  helpdesk_tickets: {
    status: "open",
    created_at: now,
  },
  holidays: {
    created_at: now,
  },
  item_assignments: {
    assigned_date: today,
    returned: false,
    created_at: now,
  },
  items: {
    total_quantity: 0,
    returnable: false,
    status: "In Stock",
    created_at: now,
    updated_at: now,
    item_type: "fixed",
  },
  knowledge_transfer_items: {
    status: "pending",
    created_at: now,
  },
  late_marks: {
    auto_half_day: false,
    created_at: now,
  },
  leave_balance_adjustments: {
    created_at: now,
  },
  leave_balances: {
    balance: money('0.00'),
  },
  leave_encashment: {
    amount: money('0.00'),
    status: "requested",
    requested_at: now,
  },
  leave_salary_workings: {
    total_amount: money('0.00'),
    status: "draft",
    updated_at: now,
  },
  notice_reads: {
    read_at: now,
  },
  notices: {
    channel: "app",
    created_at: now,
  },
  notifications: {
    created_at: now,
  },
  onboarding_tasks: {
    status: "pending",
    created_at: now,
    updated_at: now,
  },
  onboarding_template_items: {
    seq: 0,
  },
  onboarding_templates: {
    active: true,
    created_at: now,
    updated_at: now,
  },
  payroll_runs: {
    status: "draft",
    created_at: now,
  },
  payslip_adjustments: {
    advance_recovery: money('0.00'),
    loss_damage: money('0.00'),
    last_month_balance: money('0.00'),
    reimbursement_bonus: money('0.00'),
    updated_at: now,
    other_deductions: money('0.00'),
    bonus: money('0.00'),
  },
  payslips: {
    payable_days: money('0.00'),
    worked_minutes: 0,
    target_minutes: 0,
    shortfall_minutes: 0,
    per_day_rate: money('0.00'),
    basic_earned: money('0.00'),
    hra_earned: money('0.00'),
    special_earned: money('0.00'),
    earned_gross: money('0.00'),
    shortfall_amount: money('0.00'),
    pf_employee: money('0.00'),
    pf_employer: money('0.00'),
    esic_employee: money('0.00'),
    esic_employer: money('0.00'),
    professional_tax: money('0.00'),
    net_payable: money('0.00'),
    status: "draft",
    created_at: now,
    updated_at: now,
  },
  policies: {
    version: 1,
    published: false,
    created_at: now,
    updated_at: now,
  },
  policy_acknowledgements: {
    acknowledged_at: now,
  },
  pt_slabs: {
    min_gross: money('0.00'),
    created_at: now,
  },
  punch_events: {
    source: "mobile_app",
    created_at: now,
  },
  reimbursement_claims: {
    amount: money('0.00'),
    status: "pending",
    created_at: now,
  },
  reimbursement_events: {
    metadata: {},
    occurred_at: now,
  },
  requests: {
    days: money('1.00'),
    status: "pending",
    created_at: now,
  },
  role_tab_access: {
    allowed: true,
    updated_at: now,
  },
  settings: {
    updated_at: now,
  },
};
