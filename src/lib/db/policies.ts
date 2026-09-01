// ============================================================================
// Access policy per collection — the replacement for 114 RLS policies.
//
// This file IS the security boundary. Postgres used to refuse rows that were
// not yours no matter what the application asked for; nothing in MongoDB does,
// so the rules moved here and repo.ts applies them to every query it runs.
//
// Three deliberate properties:
//
//  1. DECLARATIVE. Each entry is the same shape as the SQL policy it replaces,
//     so the two can be read side by side. `supabase/migrations/0003_rls.sql`
//     and its successors are kept as the reference — they are history, not a
//     runtime dependency — and a change here without a reason traceable to
//     those is a change in who can see what.
//
//  2. FAIL CLOSED. `POLICIES` has no default entry. A collection that is not
//     listed is denied to everyone — so a newly ported collection is invisible
//     until someone decides who may read it, rather than world-readable until
//     someone notices.
//
//  3. SEPARATE READ, WRITE AND INSERT. Several tables let an employee read
//     their own rows but only modify them in a particular state — a
//     reimbursement claim is editable while pending and frozen once reviewed.
//     A single predicate cannot express that, and collapsing them is how the
//     "edit an approved claim" bug gets written.
//
// Returning null from read/write means DENY. Returning {} means no row filter,
// i.e. the whole collection.
//
// NOT HERE: role_tab_access and user_tab_access, whose SQL policies were
// `auth_role()::text = 'super_admin'`. Both are now embedded in the user
// document as `tab_access`, so that rule is enforced by the privilege tiers in
// lib/actions/users.ts rather than by a collection filter.
// ============================================================================
import 'server-only';
import type { Document } from 'mongodb';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Scope } from '@/lib/db/scope';

/**
 * A Mongo filter ANDed into every query, or null to deny outright.
 *
 * Typed as a plain Document rather than Filter<T>: a policy is written once for
 * a collection whose document type it does not know, and the driver's Filter<T>
 * is a conditional type that cannot be satisfied generically. repo.ts casts at
 * the single point where the concrete type is known.
 */
export type ScopeFilter = Document | null;

export interface CollectionPolicy {
  /** Rows this caller may see. */
  read(scope: Scope): ScopeFilter;
  /** Rows this caller may update or delete. */
  write(scope: Scope): ScopeFilter;
  /** Whether this caller may insert this document; a string is the refusal. */
  insert(scope: Scope, doc: Document): string | null;
  /**
   * SQL's WITH CHECK on an UPDATE: constrains the row the update PRODUCES,
   * where write() constrains which row it may touch. `fields` is the update's
   * $set payload. Returning a string refuses the write.
   *
   * Optional, and deliberately rare. Most tables put every condition in the
   * USING clause, and those belong in write() — requests and
   * reimbursement_claims are that shape, and folding their status into a check
   * here would wrongly let an employee touch a decided row. Only a rule about
   * the RESULT belongs here, and collapsing the two is not a simplification: it
   * is how helpdesk_tickets ended up refusing the one update it was written to
   * allow.
   */
  check?(scope: Scope, fields: Document): string | null;
  /**
   * Parent collections through which this one may ALSO be read — SQL's
   * `exists (select 1 from <parent> where … = current_employee_id())` shape.
   *
   * A read policy is handed one document and cannot join, which is why several
   * of these had to be narrowed to staff-only during the port. But an EMBEDDED
   * read already carries the join: the parent row was matched by the parent's
   * own policy, and the lookup key is what ties the child to it. So naming the
   * parent here says "reachable through that parent is reachable", which is
   * precisely what the SQL policy said.
   *
   * Applies ONLY to an embed, and only for the named parent. A direct read of
   * this collection still gets read() — narrower than the SQL was, never wider.
   */
  readableVia?: readonly string[];
}

// ---------------------------------------------------------------------------
// Building blocks. Each corresponds to one of the SQL predicates.
// ---------------------------------------------------------------------------

const DENY = () => null;
const ALL = () => ({});

/** The scheduler and migrations only — no signed-in account satisfies this. */
const systemOnly = (s: Scope): ScopeFilter => (s.isSystem ? {} : null);

/** `is_staff()` — super_admin, admin, hr. */
const staffOnly = (s: Scope): ScopeFilter => (s.isStaff ? {} : null);

/**
 * `is_portal() or employee_id = current_employee_id()` — the most common shape.
 * Staff see everything; an employee sees their own rows and nothing else.
 *
 * An account with no employee record and no staff role sees NOTHING rather
 * than everything: matching on `null` would otherwise select every row whose
 * employee_id happens to be null.
 */
const staffOrOwn =
  (field = 'employee_id') =>
  (s: Scope): ScopeFilter => {
    if (s.isStaff) return {};
    if (!s.employeeId) return null;
    return { [field]: s.employeeId };
  };

/** `recipient_id = auth.uid()` / `user_id = auth.uid()`. */
const ownUser =
  (field: string) =>
  (s: Scope): ScopeFilter => ({ [field]: s.userId });

/** Any signed-in account. Scope is only ever built for one, so this is `{}`. */
const authenticated = ALL;

/** Insert allowed only for staff. */
const insertStaff = (s: Scope): string | null =>
  s.isStaff ? null : 'Only admin or HR can create this.';

const insertSuperAdmin = (s: Scope): string | null =>
  s.isSuperAdmin ? null : 'Only a super admin can create this.';

/**
 * Insert allowed for staff, or for an employee filing their OWN row.
 *
 * The employee branch checks the document rather than trusting the caller: a
 * Server Action is a public endpoint, so `employee_id` in the payload is
 * attacker-controlled and has to be compared, not read.
 */
const insertStaffOrOwn =
  (field = 'employee_id', requiredFields: Record<string, unknown> = {}) =>
  (s: Scope, doc: Document): string | null => {
    if (s.isStaff) return null;
    if (!s.employeeId) return 'Your account is not linked to an employee record.';
    if (doc[field] !== s.employeeId) return 'You can only file this for yourself.';
    for (const [key, value] of Object.entries(requiredFields)) {
      if (doc[key] !== value) return `${key} must be ${String(value)} on a new record.`;
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
// The map. One entry per collection, mirroring its SQL policies.
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

export const POLICIES: Partial<Record<string, CollectionPolicy>> = {
  // --- identity -------------------------------------------------------------
  // `select using (id = auth.uid() or is_staff())`, `update using (id = auth.uid())`,
  // `all using (is_admin())`. Note the write rule is intentionally narrower than
  // the read rule: you may edit your own row, but role and tab access are
  // guarded again in lib/actions/users.ts, which is where privilege tiers live.
  [COLLECTIONS.users]: {
    read: (s) => (s.isStaff ? {} : { _id: s.userId }),
    write: (s) => (s.isAdminHr ? {} : { _id: s.userId }),
    insert: insertStaff,
  },

  // --- org ------------------------------------------------------------------
  // Readable by anyone signed in — branch and department names appear on almost
  // every screen, including an employee's own profile.
  [COLLECTIONS.branches]: { read: authenticated, write: staffOnly, insert: insertStaff },
  [COLLECTIONS.departments]: { read: authenticated, write: staffOnly, insert: insertStaff },
  // An employee may read their OWN record; staff read all.
  [COLLECTIONS.employees]: {
    read: (s) => (s.isStaff ? {} : s.employeeId ? { _id: s.employeeId } : null),
    write: staffOnly,
    insert: insertStaff,
  },

  // --- attendance -----------------------------------------------------------
  // Employees insert their own punches (migration 0047) but never rewrite
  // history: write stays staff-only, matching the absence of an employee
  // UPDATE/DELETE policy on punch_events in SQL.
  [COLLECTIONS.punchEvents]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },
  [COLLECTIONS.attendanceDays]: {
    read: staffOrOwn(),
    // 0047 grants employees UPDATE on their own day so a punch-out can close it.
    write: staffOrOwn(),
    insert: insertStaffOrOwn(),
  },
  [COLLECTIONS.lateMarks]: staffManagedEmployeeReadable(),
  [COLLECTIONS.holidays]: { read: authenticated, write: staffOnly, insert: insertStaff },

  // --- leave ----------------------------------------------------------------
  [COLLECTIONS.requests]: {
    read: staffOrOwn(),
    // `update using (employee_id = current_employee_id() and status = 'pending')`
    // — once a request is approved or rejected the employee can no longer touch it.
    write: ownEmployeeInState('employee_id', ['pending']),
    insert: insertStaffOrOwn('employee_id', { status: 'pending' }),
  },
  [COLLECTIONS.leaveBalances]: staffManagedEmployeeReadable(),
  [COLLECTIONS.leaveBalanceAdjustments]: staffManagedEmployeeReadable(),
  // 0009 granted UPDATE to staff only — and the comp-off feature that shipped
  // afterwards cannot work under that rule. applyCompOff() is an employee
  // action: it claims a credit ('available' -> 'applied'), links the request id
  // onto it, and puts it back on failure. Every one of those writes threw
  // ScopeError for the only people who can perform them, so the Comp off form
  // on /me answered "You do not have permission to change this" for its own
  // owner. This widens the SQL deliberately, and narrowly:
  //
  //   * only the employee's OWN credits, and only while available or applied —
  //     a credit already spent ('used') is out of reach in both directions;
  //   * the result may only be available or applied, so an employee cannot mark
  //     one used and cannot resurrect one that is;
  //   * is_applicable and employee_id are staff-only fields. is_applicable is
  //     the hold switch staff use to take a credit out of play (0041), so an
  //     employee able to set it could simply switch their own hold off.
  [COLLECTIONS.compOffs]: {
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
  [COLLECTIONS.leaveEncashment]: staffManagedEmployeeReadable(),
  [COLLECTIONS.leaveSalaryWorkings]: staffManagedEmployeeReadable(),

  // --- payroll --------------------------------------------------------------
  // 0003 created payroll_runs_read as `using (is_authenticated())` and 0004's
  // tightening loop deliberately left it out of the `sensitive` list — the row
  // is a month, a status and some timestamps, with nobody's data on it. The
  // port narrowed it to staff, which silently emptied the employee's own
  // `payslips … payroll_runs!inner(period_month)` lookup on /me: an inner join
  // against a collection they could not read dropped the payslip, so netPay
  // read as "no payslip yet" every month.
  [COLLECTIONS.payrollRuns]: { read: authenticated, write: staffOnly, insert: insertStaff },
  [COLLECTIONS.payslips]: staffManagedEmployeeReadable(),
  [COLLECTIONS.ptSlabs]: { read: staffOnly, write: staffOnly, insert: insertStaff },

  // --- assets and items -----------------------------------------------------
  // Assets scope on assigned_employee_id, not employee_id — the holder is on
  // the asset itself.
  [COLLECTIONS.assets]: staffManagedEmployeeReadable('assigned_employee_id'),
  [COLLECTIONS.assetAssignments]: staffManagedEmployeeReadable(),
  [COLLECTIONS.assetMaintenance]: staffManaged,
  // 0028 added items_read_assigned — `exists (select 1 from item_assignments a
  // where a.item_id = items.id and a.employee_id = current_employee_id())` —
  // with a comment saying it exists "so the nested item_name/category read on
  // the employee's dashboard resolves". That is exactly an embed, so it is
  // declared as one: reachable through the caller's own item_assignments, whose
  // policy has already limited the parent rows to theirs.
  //
  // A DIRECT read stays staff-only. Narrower than the SQL, and the only direct
  // reader is the staff /items screen.
  [COLLECTIONS.items]: { ...staffManaged, readableVia: [COLLECTIONS.itemAssignments] },
  [COLLECTIONS.itemAssignments]: staffManagedEmployeeReadable(),

  // --- documents and comms --------------------------------------------------
  [COLLECTIONS.employeeDocuments]: {
    read: staffOrOwn(),
    write: staffOnly,
    // An employee may upload their own, but never pre-verify it.
    insert: insertStaffOrOwn('employee_id', { verified_by: null, verified_at: null }),
  },
  // `select using (is_portal() or published_at is not null)` — staff see drafts,
  // everyone else sees only what has been published.
  [COLLECTIONS.notices]: {
    read: (s) => (s.isPortal ? {} : { published_at: { $ne: null } }),
    write: staffOnly,
    insert: insertStaff,
  },
  [COLLECTIONS.policies]: {
    read: (s) => (s.isPortal ? {} : { published: true }),
    write: staffOnly,
    insert: insertStaff,
  },
  [COLLECTIONS.policyAcknowledgements]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },
  [COLLECTIONS.acknowledgements]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },
  // Notifications scope on the USER, not the employee.
  [COLLECTIONS.notifications]: {
    read: ownUser('recipient_id'),
    write: ownUser('recipient_id'),
    // Only the system raises notifications; nothing user-facing inserts one.
    insert: insertStaff,
  },
  // 0021: `for update using (employee_id = current_employee_id())
  //        with check (employee_id = current_employee_id() and status = 'open')`.
  //
  // The status lives in the CHECK, not the USING — the point of the policy is
  // that an employee may REOPEN a resolved or closed ticket by following up on
  // it. Porting the status into write() inverted that: it made the one update
  // the rule exists to permit the one update it refused, and because
  // addTicketComment() never inspected the result, the ticket silently stayed
  // closed with HR never re-alerted.
  [COLLECTIONS.helpdeskTickets]: {
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
  // Comments are scoped by their TICKET in SQL — `exists (select 1 from
  // helpdesk_tickets …)` — and repo.ts cannot express a join. Scoping by
  // author instead, as this did, is a different rule and got both directions
  // wrong: it hid the staff replies on an employee's own ticket, and it said
  // nothing about whether the caller may see the ticket at all.
  //
  // The join now lives in the two places that need it, each doing the ticket
  // check through a SCOPED helpdesk_tickets read before touching this
  // collection: queries.getTicketComments() for reads and
  // actions/helpdesk.addTicketComment() for the insert. This filter is what
  // anything else gets, and it is deliberately staff-only rather than
  // permissive.
  [COLLECTIONS.helpdeskTicketComments]: {
    read: staffOnly,
    // Editing or deleting a comment is limited to its author either way.
    write: (s) => ({ author_id: s.userId }),
    insert: (s, doc) =>
      doc.author_id === s.userId ? null : 'You can only comment as yourself.',
  },

  // --- lifecycle ------------------------------------------------------------
  [COLLECTIONS.onboardingTemplates]: staffManaged,
  [COLLECTIONS.onboardingTasks]: staffManagedEmployeeReadable(),
  [COLLECTIONS.exitCases]: staffManagedEmployeeReadable(),
  [COLLECTIONS.fullAndFinal]: staffManaged,

  // --- reimbursements -------------------------------------------------------
  [COLLECTIONS.reimbursementClaims]: {
    read: staffOrOwn(),
    // `update using (employee_id = … and status in ('pending','rejected'))` —
    // a rejected claim may be corrected and resubmitted; an approved one may not.
    write: ownEmployeeInState('employee_id', ['pending', 'rejected']),
    insert: insertStaffOrOwn('employee_id', { status: 'pending' }),
  },
  [COLLECTIONS.reimbursementEvents]: {
    read: staffOnly,
    write: staffOnly,
    insert: insertStaff,
  },

  // --- rows scoped through a PARENT ------------------------------------------
  // SQL expressed these as `exists (select 1 from <parent> ...)`. A Mongo
  // filter cannot join, so each is scoped to staff here and the parent check
  // lives in the action that reads it. Narrower than the SQL was, never wider:
  // an employee sees these through their exit case's own action, not directly.
  [COLLECTIONS.approvalSteps]: staffManaged,
  [COLLECTIONS.exitClearanceItems]: staffManaged,
  [COLLECTIONS.exitInterviews]: staffManaged,
  [COLLECTIONS.knowledgeTransferItems]: {
    // The one exception: `handover_to = current_employee_id()` IS expressible,
    // and it is the whole point of the screen — the person receiving a handover
    // must be able to see what they are receiving.
    read: (s) => (s.isStaff ? {} : s.employeeId ? { handover_to: s.employeeId } : null),
    write: staffOnly,
    insert: insertStaff,
  },
  [COLLECTIONS.onboardingTemplateItems]: staffManaged,
  // 0004 gave this the parent-join read `id in (select id from payslips where
  // employee_id = current_employee_id())`, and mapPayslip embeds it as
  // `payslip_adjustments(*)` — it is where the bonus and the deduction lines on
  // an employee's own payslip come from. Staff-only for a direct read.
  [COLLECTIONS.payslipAdjustments]: { ...staffManaged, readableVia: [COLLECTIONS.payslips] },

  // `insert with check (employee_id = current_employee_id())`,
  // `select using (is_portal() or employee_id = current_employee_id())`.
  [COLLECTIONS.noticeReads]: {
    read: staffOrOwn(),
    write: staffOnly,
    insert: insertStaffOrOwn(),
  },

  // --- system ---------------------------------------------------------------
  // `all using (auth_role()::text = 'super_admin')`, `select using (is_portal())`.
  [COLLECTIONS.roleTabAccess]: {
    read: (s) => (s.isPortal ? {} : null),
    write: (s) => (s.isSuperAdmin ? {} : null),
    insert: insertSuperAdmin,
  },

  // Auth-owned. Read and written only by lib/auth/reset-tokens.ts, which holds
  // the collection directly — nothing may reach it through the repository, and
  // a token that could be listed would defeat the point of hashing it.
  [COLLECTIONS.passwordResetTokens]: {
    read: DENY,
    write: DENY,
    insert: () => 'Password reset tokens are managed by the auth layer.',
  },

  [COLLECTIONS.settings]: { read: authenticated, write: staffOnly, insert: insertStaff },
  [COLLECTIONS.activityLog]: { read: staffOnly, write: DENY, insert: insertStaff },
  // The scheduler's idempotency ledger. Readable by staff for support, and
  // writable ONLY by the job runner: claiming a unit of work is an insert, and
  // releasing a claim whose work then failed is a delete — see
  // db/scheduler.ts. Denied outright to every account that can sign in, which
  // is what it was before the release path needed to exist.
  [COLLECTIONS.cronRunLog]: {
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

/** The policy for a collection, or undefined when none is declared (deny). */
export function policyFor(collection: string): CollectionPolicy | undefined {
  return POLICIES[collection];
}
