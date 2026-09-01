// ============================================================================
// The plpgsql functions the app called through `.rpc()`, in TypeScript.
// SERVER ONLY.
//
// Each one was `security definer`, meaning it ran with the owner's rights and
// re-checked authorisation in its own body. That structure is preserved: these
// read through the SYSTEM scope where the SQL bypassed RLS, and each starts
// with the same explicit gate the function did — because "runs as the owner"
// with no gate is how an employee bulk-inserts leave balances from a console.
//
// Registered with pgcompat rather than imported directly, so a call site for a
// function nobody has ported yet fails loudly instead of receiving null.
// ============================================================================
import 'server-only';
import { randomUUID } from 'node:crypto';
import { COLLECTIONS, type BaseDoc } from '@/lib/db/collections';
import { scopedFor } from '@/lib/db/repo';
import { registerRpc } from '@/lib/db/pgcompat';
import { currentScope, SYSTEM_SCOPE, type Scope } from '@/lib/db/scope';
import { toDecimal } from '@/lib/db/money';
import { AppRole } from '@/types/database';
// The SQL used `now() at time zone 'Asia/Kolkata'`; this is the app's one
// definition of that date. See the note on the same import in pgcompat.ts.
import { todayIST } from '@/lib/format';

/**
 * How one of these functions was invoked.
 *
 * THIS REPLACES A PRIVILEGE ESCALATION. The old helper resolved "no session"
 * to SYSTEM_SCOPE, on the reasoning that `auth.uid() is null` in the SQL meant
 * "invoked by pg_cron". That inference does not survive the port. In Postgres,
 * a null auth.uid() really did mean there was no API request — the only way in
 * was a database connection. Here `currentScope()` returns null for every
 * authentication FAILURE as well: no cookie, a bad signature, an expired
 * token, a bumped token_version, a disabled account. So a revoked or disabled
 * user calling fn_provision_leave_balances was handed the system scope and
 * sailed past the `isStaff` gate below, writing leave balances as the system.
 *
 * The scheduler is now identified by HOW it calls, not by what it lacks: it
 * passes SCHEDULED as a separate argument. registerRpc() forwards only the
 * caller-supplied args object and never this parameter, so the privilege
 * cannot be requested over the wire.
 */
export interface Invocation {
  readonly isScheduler: boolean;
}

/** A request-borne call. The default, and never trusted. */
const REQUEST: Invocation = { isScheduler: false };

/** An in-process scheduled job. Only db/scheduler.ts may pass this. */
export const SCHEDULED: Invocation = { isScheduler: true };

/** The signed-in caller, or a refusal. Never falls back to the system. */
async function requireCaller(fn: string): Promise<Scope> {
  const scope = await currentScope();
  if (!scope) throw new NotPermitted(`${fn}: not signed in`);
  return scope;
}

class NotPermitted extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = 'NotPermitted';
  }
}

/** A numeric setting with a default. Replaces fn_setting_numeric(). */
async function settingNumeric(key: string, fallback: number): Promise<number> {
  const settings = scopedFor<BaseDoc & { key: string; value: unknown }>(COLLECTIONS.settings, SYSTEM_SCOPE);
  const row = await settings.findOne({ key });
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// fn_on_leave_today
// ---------------------------------------------------------------------------

export interface OnLeaveRow {
  employee_id: string;
  full_name: string;
  branch: string;
  start_date: string;
  end_date: string;
}

/**
 * Everyone on approved leave today.
 *
 * SECURITY DEFINER in SQL: any signed-in user may see the list, which is why it
 * reads through the system scope rather than the caller's — an employee could
 * not otherwise see a colleague's leave. Only the names, branch and dates are
 * returned; nothing about the reason or the leave type.
 */
async function onLeaveToday(): Promise<OnLeaveRow[]> {
  const scope = await currentScope();
  if (!scope) throw new NotPermitted('fn_on_leave_today: not signed in');

  const today = todayIST();
  const requests = scopedFor<BaseDoc>(COLLECTIONS.requests, SYSTEM_SCOPE);

  const rows = await requests.aggregate<OnLeaveRow & { _id: string }>([
    {
      $match: {
        type: 'leave',
        status: 'approved',
        start_date: { $lte: today },
        end_date: { $gte: today },
      },
    },
    {
      $lookup: {
        from: COLLECTIONS.employees,
        localField: 'employee_id',
        foreignField: '_id',
        as: 'e',
        pipeline: [
          { $match: { status: { $in: ['active', 'on_notice'] } } },
          { $project: { full_name: 1, branch_name: 1 } },
        ],
      },
    },
    // Inner join: the SQL's `join employees` dropped rows whose employee is
    // inactive, and so must this.
    { $unwind: '$e' },
    {
      $project: {
        _id: 0,
        employee_id: '$employee_id',
        full_name: '$e.full_name',
        branch: { $ifNull: ['$e.branch_name', ''] },
        start_date: 1,
        end_date: 1,
      },
    },
    { $sort: { full_name: 1 } },
  ]);

  return rows;
}

// ---------------------------------------------------------------------------
// fn_init_approval_steps
// ---------------------------------------------------------------------------

/**
 * Seed a request's approval chain: hr -> admin, as deep as
 * settings.leave_approval_levels says.
 *
 * The gate is "staff, or the owner of this request" — employees do
 * legitimately reach this by filing their own leave, so it cannot simply be
 * staff-only, and it must not be "any signed-in user, any request id" either.
 * Nothing schedules this, so there is no system path: it is only ever reached
 * from a request, and an unauthenticated one is refused.
 */
async function initApprovalSteps(args: { p_request_id?: string }): Promise<number> {
  const requestId = args.p_request_id;
  if (!requestId) return 0;

  const scope = await requireCaller('fn_init_approval_steps');

  if (!scope.isStaff) {
    // Looked up through the system scope on purpose: the check must see the
    // real row, not one already filtered by the caller's own policy.
    const all = scopedFor<BaseDoc>(COLLECTIONS.requests, SYSTEM_SCOPE);
    const owned = await all.findOne({ _id: requestId, employee_id: scope.employeeId });
    if (!owned) {
      throw new NotPermitted(
        'Not permitted: an approval chain may only be seeded for your own request.',
      );
    }
  }

  // Clamped: 0 levels leaves a request nobody can approve, and an absurd value
  // spawns a chain no one can clear.
  const configured = Math.trunc(await settingNumeric('leave_approval_levels', 1));
  const levels = Math.min(Math.max(configured, 1), 5);

  const steps = scopedFor<BaseDoc>(COLLECTIONS.approvalSteps, SYSTEM_SCOPE);
  const roleFor = (n: number) => (n === 1 ? 'hr' : 'admin') as AppRole;

  let made = 0;
  for (let n = 1; n <= levels; n++) {
    // `on conflict (request_id, step_no) do nothing` — re-seeding a chain that
    // already exists must add nothing rather than duplicating the steps.
    const existing = await steps.countDocuments({ request_id: requestId, step_no: n });
    if (existing > 0) continue;
    await steps.insertOne({
      _id: randomUUID(),
      request_id: requestId,
      step_no: n,
      approver_role: roleFor(n),
      created_at: new Date(),
    });
    made++;
  }
  return made;
}

// ---------------------------------------------------------------------------
// fn_provision_leave_balances
// ---------------------------------------------------------------------------

/**
 * Open a leave year: one PL row per employee, annual entitlement plus capped
 * carry-forward from last year.
 *
 * CL and SL are retired — one pool now — and LWP is a request kind, never an
 * entitlement, so neither appears here.
 */
async function provisionLeaveBalances(
  args: { p_year?: number },
  invocation: Invocation = REQUEST,
): Promise<number> {
  const year = Number(args.p_year);

  // `invocation` is a SEPARATE parameter, not a field of `args`, precisely so
  // that a caller who controls the rpc payload cannot set it.
  if (!invocation.isScheduler) {
    const scope = await requireCaller('fn_provision_leave_balances');
    if (!scope.isStaff) {
      throw new NotPermitted(
        'Not permitted: only staff (or the scheduler) may provision a leave year.',
      );
    }
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error(`fn_provision_leave_balances: implausible year ${args.p_year}`);
  }

  // Floored at 0 so a negative cap cannot turn carry-forward into a debit.
  const cap = Math.max(await settingNumeric('leave_carry_forward_cap', 0), 0);
  const annual = await settingNumeric('leave_annual_pl', 15);

  const employees = scopedFor<BaseDoc>(COLLECTIONS.employees, SYSTEM_SCOPE);
  const balances = scopedFor<BaseDoc>(COLLECTIONS.leaveBalances, SYSTEM_SCOPE);

  // 'on_notice' still works and still takes leave; 'inactive' is excluded.
  const staff = await employees.find(
    {
      status: { $in: ['active', 'on_notice'] },
      date_of_joining: { $lte: `${year}-12-31` },
    },
    { projection: { _id: 1 } },
  );

  const previous = new Map<string, number>();
  for (const row of await balances.find({ year: year - 1, type: 'PL' })) {
    previous.set(row.employee_id as string, Number(row.balance ?? 0));
  }

  let created = 0;
  for (const e of staff) {
    const exists = await balances.countDocuments({ employee_id: e._id, year, type: 'PL' });
    if (exists > 0) continue; // `on conflict ... do nothing`

    const carried = Math.min(Math.max(previous.get(e._id as string) ?? 0, 0), cap);
    await balances.insertOne({
      _id: randomUUID(),
      employee_id: e._id,
      year,
      type: 'PL',
      // Leave is tracked in half-days, so one decimal place — matching
      // `round(..., 1)` in the SQL. Stored as Decimal128: the column is
      // `bsonType: "decimal"`, and a JS number failed the validator on the
      // first employee, which aborted the whole provisioning run — after the
      // cron ledger had already claimed the year, so it never retried.
      balance: toDecimal(Math.round((annual + carried) * 10) / 10),
      created_at: new Date(),
      updated_at: new Date(),
    });
    created++;
  }

  if (created > 0) {
    const log = scopedFor<BaseDoc>(COLLECTIONS.activityLog, SYSTEM_SCOPE);
    await log.insertOne({
      _id: randomUUID(),
      actor_id: null,
      actor_name: null,
      employee_id: null,
      event_type: 'leave_provision',
      message: `Provisioned ${created} paid-leave balance row(s) for ${year}`,
      metadata: { year, created, carry_forward_cap: cap },
      occurred_at: new Date(),
    });
  }

  return created;
}

// ---------------------------------------------------------------------------

let registered = false;

/** Wire the TypeScript implementations into the `.rpc()` surface. Idempotent. */
export function registerDbFunctions(): void {
  if (registered) return;
  registered = true;
  registerRpc('fn_on_leave_today', () => onLeaveToday());
  registerRpc('fn_init_approval_steps', (a) => initApprovalSteps(a as { p_request_id?: string }));
  // One argument only. Passing `(a, b) => …` here, or spreading the payload,
  // would let a request supply the invocation and grant itself the scheduler's
  // exemption.
  registerRpc('fn_provision_leave_balances', (a) => provisionLeaveBalances(a as { p_year?: number }));
}

export { onLeaveToday, initApprovalSteps, provisionLeaveBalances };
