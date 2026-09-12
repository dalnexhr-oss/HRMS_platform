/**
 * Collection access control policies (row/document-level security).
 *
 * Core principles:
 * 1. Declarative: Pre-operation predicates defined per collection (read, write, insert, check).
 * 2. Fail-closed: Unlisted collections are inaccessible by default (return null / throw ScopeError).
 * 3. Operation separation: Read, write, and insert permissions are decoupled to enforce state transitions.
 */
import 'server-only';
import type { Document } from 'mongodb';
import { collections } from '@/lib/db/collections';
import type { Scope } from '@/lib/db/scope';

// A Mongo filter ANDed into every query, or null to deny outright. Typed as a plain Document rather than Filter<T>: a policy is written once for a collection whose document type it does not know, and the driver's Filter<T> is a conditional type that cannot be satisfied generically. repo.ts casts at the single point where the concrete type is known.
export type ScopeFilter = Document | null;

export interface CollectionPolicy {
  // Rows this caller may see.
  read(scope: Scope): ScopeFilter;
  // Rows this caller may update or delete.
  write(scope: Scope): ScopeFilter;
  // Whether this caller may insert this document; a string is the refusal.
  insert(scope: Scope, doc: Document): string | null;
  // Validates update payload fields ($set) against security constraints.
  check?(scope: Scope, fields: Document): string | null;
  // Parent collections through which child documents inherit read visibility during embedded queries.
  readableVia?: readonly string[];
}

//
// Building blocks. Each corresponds to one of the SQL predicates.
//

const deny = () => null;
const all = () => ({});

// The scheduler and migrations only — no signed-in account satisfies this.
const systemOnly = (s: Scope): ScopeFilter => (s.isSystem ? {} : null);

// `is_staff()` — super_admin, admin, hr.
const staffOnly = (s: Scope): ScopeFilter => (s.isStaff ? {} : null);

// `is_portal() or employee_id = current_employee_id()` — the most common shape. Staff see everything; an employee sees their own rows and nothing else. An account with no employee record and no staff role sees NOTHING rather than everything: matching on `null` would otherwise select every row whose employee_id happens to be null.
const staffOrOwn =
  (field = 'employee_id') =>
  (s: Scope): ScopeFilter => {
    if (s.isStaff) return {};
    if (!s.employeeId) return null;
    return { [field]: s.employeeId };
  };

// `recipient_id = auth.uid()` / `user_id = auth.uid()`.
const ownUser =
  (field: string) =>
  (s: Scope): ScopeFilter => ({ [field]: s.userId });

// Any signed-in account. Scope is only ever built for one, so this is `{}`.
const authenticated = all;

// Insert allowed only for staff.
const insertStaff = (s: Scope): string | null =>
  s.isStaff ? null : 'Only admin or HR can create this.';

const insertSuperAdmin = (s: Scope): string | null =>
  s.isSuperAdmin ? null : 'Only a super admin can create this.';

/**
 * Validates insert permissions for staff or the owning employee record.
 * Asserts document required fields against caller identity.
 */
const insertStaffOrOwn =
  (field = 'employee_id', requiredFields: Record<string, unknown> = {}) =>
  (s: Scope, doc: Document): string | null => {
    if (s.isStaff) return null;
    if (!s.employeeId) return 'Your account is not linked to an employee record.';
    if (doc[field] !== s.employeeId) return 'You can only file this for yourself.';
    for (const [key, value] of Object.entries(requiredFields)) {
      const supplied = doc[key] === undefined ? null : doc[key];
      if (supplied !== value) return `${key} must be ${String(value)} on a new record.`;
    }
    return null;
  };

/** Own rows, and only while they are in one of these states. */
const ownEmployeeInState =
  (field: string, states: string[], stateField = 'status') =>
  (s: Scope): ScopeFilter => {
    if (s.isStaff) return {};
    if (!s.employeeId) return null;
    return { [field]: s.employeeId, [stateField]: { $in: states } };
  };

// ---------------------------------------------------------------------------
// Collection policy map.
// ---------------------------------------------------------------------------

const staffManaged: CollectionPolicy = {
  read: staffOnly,
  write: staffOnly,
  insert: insertStaff,
};

/** Staff manage it; an employee may read their own rows. */
const staffManagedEmployeeReadable = (field = 'employee_id'): CollectionPolicy => ({
  read: staffOrOwn(field),
  write: staffOnly,
  insert: insertStaff,
});

export const policies: Partial<Record<string, CollectionPolicy>> = {
  // --- identity -------------------------------------------------------------
  // `select using (id = auth.uid() or is_staff())`, `update using (id = auth.uid())`,
  // `all using (is_admin())`. Note the write rule is intentionally narrower than
  // the read rule: you may edit your own row, but role and tab access are
  // guarded again in lib/actions/users.ts, which is where privilege tiers live.
  [collections.users]: {
    read: (s) => (s.isStaff ? {} : { _id: s.userId }),
    write: (s) => (s.isAdminHr ? {} : { _id: s.userId }),
    insert: insertStaff,
  },

  // --- org ------------------------------------------------------------------
  // Readable by anyone signed in — branch and department names appear on almost
  // every screen, including an employee's own profile.
  [collections.branches]: { read: authenticated, write: staffOnly, insert: insertStaff },
  [collections.departments]: { read: authenticated, write: staffOnly, insert: insertStaff },
  // An employee may read their OWN record; staff read all.
  [collections.employees]: {
    read: (s) => (s.isStaff ? {} : s.employeeId ? { _id: s.employeeId } : null),
    write: staffOnly,
    insert: insertStaff,
  },

  // --- attendance -----------------------------------------------------------
  // Employees insert their own punches; modifications require staff privileges.
  [collections.punchEvents]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },
  [collections.attendanceDays]: {
    read: staffOrOwn(),
    // Employees may update their own attendance day (e.g. recording punch-out).
    write: staffOrOwn(),
    insert: insertStaffOrOwn(),
  },
  [collections.lateMarks]: staffManagedEmployeeReadable(),
  [collections.holidays]: { read: authenticated, write: staffOnly, insert: insertStaff },

  // --- leave ----------------------------------------------------------------
  [collections.requests]: {
    read: staffOrOwn(),
    // Employees may only modify their own requests while in 'pending' status.
    write: ownEmployeeInState('employee_id', ['pending']),
    insert: insertStaffOrOwn('employee_id', { status: 'pending' }),
  },
  [collections.leaveBalances]: staffManagedEmployeeReadable(),
  [collections.leaveBalanceAdjustments]: staffManagedEmployeeReadable(),
  // Comp-off policies: employees may claim or cancel available credits; only HR can mark used or hold.
  [collections.compOffs]: {
    read: staffOrOwn(),
    write: ownEmployeeInState('employee_id', ['available', 'applied']),
    check: (s, fields) => {
      if (s.isStaff) return null;
      if (fields.status !== undefined && fields.status !== 'available' && fields.status !== 'applied') {
        return 'Only HR can mark a comp off used.';
      }
      if (fields.is_applicable !== undefined) return 'Only HR can put a comp off on hold.';
      if (fields.employee_id !== undefined) return 'A comp off cannot be moved to another employee.';
      return null;
    },
    insert: insertStaff,
  },
  [collections.leaveEncashment]: staffManagedEmployeeReadable(),
  [collections.leaveSalaryWorkings]: staffManagedEmployeeReadable(),

  // --- payroll --------------------------------------------------------------
  // General run metadata readable by authenticated callers for payslip period joins.
  [collections.payrollRuns]: { read: authenticated, write: staffOnly, insert: insertStaff },
  [collections.payslips]: staffManagedEmployeeReadable(),
  [collections.ptSlabs]: { read: staffOnly, write: staffOnly, insert: insertStaff },

  // --- assets and items -----------------------------------------------------
  // Assets scope on assigned_employee_id, not employee_id — the holder is on
  // the asset itself.
  [collections.assets]: staffManagedEmployeeReadable('assigned_employee_id'),
  [collections.assetAssignments]: staffManagedEmployeeReadable(),
  [collections.assetMaintenance]: staffManaged,
  // Items catalog is directly accessible to staff, or embedded via an employee's assigned items.
  [collections.items]: { ...staffManaged, readableVia: [collections.itemAssignments] },
  [collections.itemAssignments]: staffManagedEmployeeReadable(),

  // --- documents and comms
  [collections.employeeDocuments]: {
    read: staffOrOwn(),
    write: staffOnly,
    // An employee may upload their own, but never pre-verify it.
    insert: insertStaffOrOwn('employee_id', { verified_by: null, verified_at: null }),
  },
  // `select using (is_portal() or published_at is not null)` — staff see drafts,
  // everyone else sees only what has been published.
  [collections.notices]: {
    read: (s) => (s.isPortal ? {} : { published_at: { $ne: null } }),
    write: staffOnly,
    insert: insertStaff,
  },
  [collections.policies]: {
    read: (s) => (s.isPortal ? {} : { published: true }),
    write: staffOnly,
    insert: insertStaff,
  },
  [collections.policyAcknowledgements]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },
  [collections.acknowledgements]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },
  // Notifications scope on the USER, not the employee.
  [collections.notifications]: {
    read: ownUser('recipient_id'),
    write: ownUser('recipient_id'),
    // Only the system raises notifications; nothing user-facing inserts one.
    insert: insertStaff,
  },
  // Employees may view and update their own tickets; status check permits reopening to 'open' status.
  [collections.helpdeskTickets]: {
    read: staffOrOwn(),
    write: staffOrOwn(),
    check: (s, fields) => {
      if (s.isStaff) return null;
      if (fields.status !== undefined && fields.status !== 'open') {
        return 'You can only reopen your own ticket.';
      }
      return null;
    },
    insert: insertStaffOrOwn(),
  },
  // Direct queries are staff-only; employee ticket comment access is validated via parent ticket.
  [collections.helpdeskTicketComments]: {
    read: staffOnly,
    // Editing or deleting a comment is limited to its author either way.
    write: (s) => ({ author_id: s.userId }),
    insert: (s, doc) =>
      doc.author_id === s.userId ? null : 'You can only comment as yourself.',
  },

  // --- lifecycle
  [collections.onboardingTemplates]: staffManaged,
  [collections.onboardingTasks]: staffManagedEmployeeReadable(),
  [collections.exitCases]: staffManagedEmployeeReadable(),
  [collections.fullAndFinal]: staffManaged,

  // --- reimbursements
  [collections.reimbursementClaims]: {
    read: staffOrOwn(),
    // Editable only while pending or rejected (resubmission).
    write: ownEmployeeInState('employee_id', ['pending', 'rejected']),
    insert: insertStaffOrOwn('employee_id', { status: 'pending' }),
  },
  [collections.reimbursementEvents]: {
    read: staffOnly,
    write: staffOnly,
    insert: insertStaff,
  },

  // --- Parent-scoped child collections: access mediated by parent record check ---
  [collections.approvalSteps]: staffManaged,
  [collections.exitClearanceItems]: staffManaged,
  [collections.exitInterviews]: staffManaged,
  [collections.knowledgeTransferItems]: {
    // Handover recipient can read assigned transfer items.
    read: (s) => (s.isStaff ? {} : s.employeeId ? { handover_to: s.employeeId } : null),
    write: staffOnly,
    insert: insertStaff,
  },
  [collections.onboardingTemplateItems]: staffManaged,
  // Payslip adjustments are directly staff-managed, but readable via parent payslip lookup.
  [collections.payslipAdjustments]: { ...staffManaged, readableVia: [collections.payslips] },

  // Notice read receipts: staff read/manage all, employees record and view their own receipts.
  [collections.noticeReads]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },

  // --- system
  // Global settings: readable by portal users, editable by super_admin.
  [collections.roleTabAccess]: {
    read: (s) => (s.isPortal ? {} : null),
    write: (s) => (s.isSuperAdmin ? {} : null),
    insert: insertSuperAdmin,
  },

  // Auth-owned. Read and written only by lib/auth/reset-tokens.ts, which holds
  // the collection directly — nothing may reach it through the repository, and
  // a token that could be listed would defeat the point of hashing it.
  [collections.passwordResetTokens]: {
    read: deny,
    write: deny,
    insert: () => 'Password reset tokens are managed by the auth layer.',
  },

  [collections.settings]: { read: authenticated, write: staffOnly, insert: insertStaff },
  [collections.activityLog]: { read: staffOnly, write: deny, insert: insertStaff },
  // The scheduler's idempotency ledger. Readable by staff for support, and
  // writable ONLY by the job runner: claiming a unit of work is an insert, and
  // releasing a claim whose work then failed is a delete — see
  // db/scheduler.ts. Denied outright to every account that can sign in, which
  // is what it was before the release path needed to exist.
  [collections.cronRunLog]: {
    read: staffOnly,
    write: systemOnly,
    // systemOnly's shape, not insertSuperAdmin's: a super_admin is an account
    // that can sign in, and letting one insert here is enough to stop the
    // scheduler permanently. cronClaim() treats a duplicate run_key as "already
    // done", so a single planted `{job:'auto_close_month', run_key:'2026-09-01'}`
    // makes that month never close, its notices never purge and its leave year
    // never provision — silently, with the job reporting success.
    insert: (s) => (s.isSystem ? null : 'The cron ledger is written only by the scheduler.'),
  },
};

// The policy for a collection, or undefined when none is declared (deny).
export function policyFor(collection: string): CollectionPolicy | undefined {
  return policies[collection];
}
