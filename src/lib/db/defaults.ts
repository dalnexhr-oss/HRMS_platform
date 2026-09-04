// ============================================================================
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
// ============================================================================
import { Decimal128 } from 'mongodb';

/** Marker for `now()` — resolved per insert, never at module load. */
export const NOW = Symbol('now');
/** Marker for `current_date` — an IST calendar date, as `YYYY-MM-DD`. */
export const TODAY = Symbol('today');

const money = (v: string): Decimal128 => Decimal128.fromString(v);

export type DefaultValue = string | number | boolean | Decimal128 | object | symbol;

/** collection -> field -> the value Postgres would have supplied. */
export const COLUMN_DEFAULTS: Record<string, Record<string, DefaultValue>> = {
  acknowledgements: {
    signed_at: NOW,
  },
  activity_log: {
    metadata: {},
    occurred_at: NOW,
  },
  approval_steps: {
    status: "pending",
    created_at: NOW,
  },
  asset_assignments: {
    assigned_date: TODAY,
    returned: false,
    created_at: NOW,
  },
  asset_maintenance: {
    maint_date: TODAY,
    created_at: NOW,
  },
  assets: {
    created_at: NOW,
    updated_at: NOW,
  },
  attendance_days: {
    worked_minutes: 0,
    is_corrected: false,
    created_at: NOW,
    updated_at: NOW,
  },
  branches: {
    geofence_radius_m: 150,
    created_at: NOW,
  },
  comp_offs: {
    status: "available",
    created_at: NOW,
    is_applicable: true,
  },
  cron_run_log: {
    ran_at: NOW,
  },
  employee_documents: {
    uploaded_at: NOW,
    bucket: "employee-documents",
  },
  employees: {
    employment_type: "employee",
    gross_monthly: money('0.00'),
    basic_da: money('0.00'),
    hra: money('0.00'),
    special_allowance: money('0.00'),
    status: "active",
    created_at: NOW,
    updated_at: NOW,
  },
  exit_cases: {
    stage: "initiated",
    created_at: NOW,
    updated_at: NOW,
  },
  exit_clearance_items: {
    cleared: false,
    created_at: NOW,
  },
  exit_interviews: {
    created_at: NOW,
  },
  full_and_final: {
    salary_payable: money('0.00'),
    leave_encashment: money('0.00'),
    pending_reimbursements: money('0.00'),
    asset_recovery: money('0.00'),
    other_deductions: money('0.00'),
    net_payable: money('0.00'),
    status: "draft",
    created_at: NOW,
    updated_at: NOW,
  },
  helpdesk_ticket_comments: {
    author_is_staff: false,
    created_at: NOW,
  },
  helpdesk_tickets: {
    status: "open",
    created_at: NOW,
  },
  holidays: {
    created_at: NOW,
  },
  item_assignments: {
    assigned_date: TODAY,
    returned: false,
    created_at: NOW,
  },
  items: {
    total_quantity: 0,
    returnable: false,
    status: "In Stock",
    created_at: NOW,
    updated_at: NOW,
    item_type: "fixed",
  },
  knowledge_transfer_items: {
    status: "pending",
    created_at: NOW,
  },
  late_marks: {
    auto_half_day: false,
    created_at: NOW,
  },
  leave_balance_adjustments: {
    created_at: NOW,
  },
  leave_balances: {
    balance: money('0.00'),
  },
  leave_encashment: {
    amount: money('0.00'),
    status: "requested",
    requested_at: NOW,
  },
  leave_salary_workings: {
    total_amount: money('0.00'),
    status: "draft",
    updated_at: NOW,
  },
  notice_reads: {
    read_at: NOW,
  },
  notices: {
    channel: "app",
    created_at: NOW,
  },
  notifications: {
    created_at: NOW,
  },
  onboarding_tasks: {
    status: "pending",
    created_at: NOW,
    updated_at: NOW,
  },
  onboarding_template_items: {
    seq: 0,
  },
  onboarding_templates: {
    active: true,
    created_at: NOW,
    updated_at: NOW,
  },
  payroll_runs: {
    status: "draft",
    created_at: NOW,
  },
  payslip_adjustments: {
    advance_recovery: money('0.00'),
    loss_damage: money('0.00'),
    last_month_balance: money('0.00'),
    reimbursement_bonus: money('0.00'),
    updated_at: NOW,
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
    created_at: NOW,
    updated_at: NOW,
  },
  policies: {
    version: 1,
    published: false,
    created_at: NOW,
    updated_at: NOW,
  },
  policy_acknowledgements: {
    acknowledged_at: NOW,
  },
  pt_slabs: {
    min_gross: money('0.00'),
    created_at: NOW,
  },
  punch_events: {
    source: "mobile_app",
    created_at: NOW,
  },
  reimbursement_claims: {
    amount: money('0.00'),
    status: "pending",
    created_at: NOW,
  },
  reimbursement_events: {
    metadata: {},
    occurred_at: NOW,
  },
  requests: {
    days: money('1.00'),
    status: "pending",
    created_at: NOW,
  },
  role_tab_access: {
    allowed: true,
    updated_at: NOW,
  },
  settings: {
    updated_at: NOW,
  },
};
