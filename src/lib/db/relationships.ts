// ============================================================================
// How one collection joins to another. SERVER ONLY.
//
// WHY THIS IS A TABLE AND NOT A RULE.
//
// pgcompat used to derive an embed's join key from the table NAME: strip the
// plural, append `_id`. That convention holds for most of the schema and is
// wrong in four different ways for the rest, and every one of those failures is
// SILENT — $lookup on a field no document has matches nothing, $unwind with
// preserveNullAndEmptyArrays keeps the row, and the screen renders blanks:
//
//   payslip_adjustments   keyed BY the payslip's own id (`id uuid primary key
//                         references payslips(id)`), not by a
//                         `payslip_adjustment_id` column. This is the one that
//                         hid every advance recovery, loss/damage and bonus on
//                         the payroll screen while computePayslip had already
//                         applied them — the table and the payslip disagreed.
//   onboarding_template_items
//                         the CHILD holds the key (template_id), so the join
//                         runs the other way round.
//   knowledge_transfer_items -> employees
//                         via `handover_to`; that table has no employee_id at
//                         all, so the convention produced an empty join.
//   helpdesk_tickets / reimbursement_claims / onboarding_templates
//                         are referenced as ticket_id / claim_id / template_id,
//                         which the plural rule does not produce.
//
// So the relationships are declared, one entry per (parent, embed) pair that
// the application actually selects. An embed with no entry THROWS rather than
// joining on a guess — silently returning nothing is what this file exists to
// stop. Adding an embed to a select means adding its entry here.
// ============================================================================
import 'server-only';

export interface Relationship {
  /** PostgREST table name being embedded; collectionFor() maps it if it differs. */
  table: string;
  /** Field on the LOCAL document. `_id` when the foreign side holds the key. */
  localField: string;
  /** Field on the FOREIGN document. `_id` for an ordinary to-one join. */
  foreignField: string;
  /**
   * Whether many foreign rows can match one local row.
   *
   * Decides the shape PostgREST would have returned, and therefore whether the
   * pipeline unwinds: a to-one embed is an object, a to-many is an array.
   */
  toMany: boolean;
}

const toOne = (table: string, localField: string): Relationship => ({
  table,
  localField,
  foreignField: '_id',
  toMany: false,
});

/**
 * Keyed by the PARENT table, then by the embed's alias as written in the
 * select list. The parent matters: `employees(...)` means employee_id almost
 * everywhere and handover_to on knowledge_transfer_items.
 */
export const RELATIONSHIPS: Record<string, Record<string, Relationship>> = {
  // --- employees and the things hanging off them ---------------------------
  // employees.branch_id -> branches.id, employees.department_id -> departments.id
  employees: {
    branches: toOne('branches', 'branch_id'),
    departments: toOne('departments', 'department_id'),
  },

  attendance_days: { employees: toOne('employees', 'employee_id') },
  requests: { employees: toOne('employees', 'employee_id') },
  leave_balances: { employees: toOne('employees', 'employee_id') },
  leave_salary_workings: { employees: toOne('employees', 'employee_id') },
  exit_cases: { employees: toOne('employees', 'employee_id') },
  employee_documents: { employees: toOne('employees', 'employee_id') },
  onboarding_tasks: { employees: toOne('employees', 'employee_id') },
  helpdesk_tickets: { employees: toOne('employees', 'employee_id') },
  reimbursement_claims: { employees: toOne('employees', 'employee_id') },
  comp_offs: { employees: toOne('employees', 'employee_id') },

  // knowledge_transfer_items has NO employee_id — the person is the one
  // RECEIVING the handover. `handover_to uuid references employees(id)`.
  knowledge_transfer_items: { employees: toOne('employees', 'handover_to') },

  // --- payroll --------------------------------------------------------------
  payslips: {
    employees: toOne('employees', 'employee_id'),
    payroll_runs: toOne('payroll_runs', 'payroll_run_id'),
    // `id uuid primary key references payslips(id) on delete cascade` — the
    // adjustment row IS the payslip row, sharing its primary key.
    payslip_adjustments: {
      table: 'payslip_adjustments',
      localField: '_id',
      foreignField: '_id',
      toMany: false,
    },
  },

  // --- items and assets -----------------------------------------------------
  item_assignments: {
    items: toOne('items', 'item_id'),
    employees: toOne('employees', 'employee_id'),
  },
  asset_assignments: {
    assets: toOne('assets', 'asset_id'),
    employees: toOne('employees', 'employee_id'),
  },

  // --- reverse joins: the CHILD holds the key ------------------------------
  onboarding_templates: {
    onboarding_template_items: {
      table: 'onboarding_template_items',
      localField: '_id',
      foreignField: 'template_id',
      toMany: true,
    },
  },
};

/**
 * The declared relationship, or null when there is none.
 *
 * The caller turns null into a thrown error naming both sides, so an embed
 * added to a query without a matching entry here fails at the first call
 * rather than rendering an empty column that looks like missing data.
 */
export function relationshipFor(parentTable: string, alias: string): Relationship | null {
  return RELATIONSHIPS[parentTable]?.[alias] ?? null;
}
