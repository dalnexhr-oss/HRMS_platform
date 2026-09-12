// Declarative foreign key relationship registry for aggregation lookups. SERVER ONLY.
//
// Defines explicit join criteria (local/foreign keys and cardinality) per parent-child
// pair instead of relying on heuristics, ensuring strict resolution of non-standard
// foreign keys (e.g. handover_to, 1:1 shared primary keys, and parent-referenced collections).

import 'server-only';

export interface Relationship {
  // Target collection name for lookup pipeline; mapped via collectionFor() if aliased.
  table: string;
  // Field on the local document. '_id' when child holds the foreign key.
  localField: string;
  // Field on the foreign document. '_id' for standard to-one joins.
  foreignField: string;
  // Cardinality flag: false unwinds to an embedded object, true preserves array.
  toMany: boolean;
}

const toOne = (table: string, localField: string): Relationship => ({
  table,
  localField,
  foreignField: '_id',
  toMany: false,
});

// Registry indexed by parent collection, then by embed alias in the selection projection.
export const relationships: Record<string, Record<string, Relationship>> = {
  // --- employees and the things hanging off them
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

  // Foreign key references the recipient of the handover.
  knowledge_transfer_items: { employees: toOne('employees', 'handover_to') },

  // --- payroll
  payslips: {
    employees: toOne('employees', 'employee_id'),
    payroll_runs: toOne('payroll_runs', 'payroll_run_id'),
    // 1:1 relationship sharing the payslip primary key (_id).
    payslip_adjustments: {
      table: 'payslip_adjustments',
      localField: '_id',
      foreignField: '_id',
      toMany: false,
    },
  },

  // --- items and assets
  item_assignments: {
    items: toOne('items', 'item_id'),
    employees: toOne('employees', 'employee_id'),
  },
  asset_assignments: {
    assets: toOne('assets', 'asset_id'),
    employees: toOne('employees', 'employee_id'),
  },

  // --- reverse joins: the CHILD holds the key
  onboarding_templates: {
    onboarding_template_items: {
      table: 'onboarding_template_items',
      localField: '_id',
      foreignField: 'template_id',
      toMany: true,
    },
  },
};

// Returns declared relationship metadata or null if undefined (invoker should fail fast).
export function relationshipFor(parentTable: string, alias: string): Relationship | null {
  return relationships[parentTable]?.[alias] ?? null;
}
