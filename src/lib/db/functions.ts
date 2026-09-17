// RPC handlers for privileged domain operations. Each handler checks authorization before using
// system scope.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { collections } from '@/lib/db/collections';
import { scopedFor } from '@/lib/db/repo';
import { registerRpc } from '@/lib/db/query-client';
import { toDecimal } from '@/lib/db/money';
import { todayIST } from '@/lib/format';
import { currentScope, systemScope } from '@/lib/db/scope';
import type { AppRole } from '@/types/database';
import type { Scope } from '@/lib/db/scope';
import type { BaseDoc } from '@/lib/db/collections';

// Only internal jobs may set this context; RPC dispatch never accepts it from clients.
export interface Invocation {
  readonly isScheduler: boolean;
}

// A request-borne call. The default, and never trusted.
const request: Invocation = { isScheduler: false };

// An in-process scheduled job. Only db/scheduler.ts may pass this.
export const scheduled: Invocation = { isScheduler: true };

// The signed-in caller, or a refusal. Never falls back to the system.
async function requireCaller(fn: string): Promise<Scope> {
  const scope = await currentScope();
  if (!scope) {
    throw new NotPermitted(`${fn}: not signed in`);
  }
  return scope;
}

class NotPermitted extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = 'NotPermitted';
  }
}

/** Retrieves a numeric configuration setting with a fallback default. */
async function settingNumeric(key: string, fallback: number): Promise<number> {
  const settings = scopedFor<BaseDoc & { key: string; value: unknown }>(
    collections.settings,
    systemScope,
  );
  const row = await settings.findOne({ key });
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

// fn_on_leave_today

export interface OnLeaveRow {
  employee_id: string;
  full_name: string;
  branch: string;
  start_date: string;
  end_date: string;
}

/**
 * Returns active employees on approved leave today across all branches.
 * Readable by any authenticated user; omits leave reasons and types for privacy.
 */
async function onLeaveToday(): Promise<OnLeaveRow[]> {
  const scope = await currentScope();
  if (!scope) {
    throw new NotPermitted('fn_on_leave_today: not signed in');
  }

  const today = todayIST();
  const requests = scopedFor<BaseDoc>(collections.requests, systemScope);

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
        from: collections.employees,
        localField: 'employee_id',
        foreignField: '_id',
        as: 'e',
        pipeline: [
          { $match: { status: { $in: ['active', 'on_notice'] } } },
          { $project: { full_name: 1, branch_name: 1 } },
        ],
      },
    },
    // Exclude records where the employee is inactive.
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

// fn_init_approval_steps

/**
 * Seeds sequential approval chain (hr -> admin) for a leave request based on configured approval levels.
 * Caller must be HR/admin staff or the owner of the target request.
 */
async function initApprovalSteps(args: { p_request_id?: string }): Promise<number> {
  const requestId = args.p_request_id;
  if (!requestId) {
    return 0;
  }

  const scope = await requireCaller('fn_init_approval_steps');

  if (!scope.isStaff) {
    // Looked up through the system scope on purpose: the check must see the
    // real row, not one already filtered by the caller's own policy.
    const all = scopedFor<BaseDoc>(collections.requests, systemScope);
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

  const steps = scopedFor<BaseDoc>(collections.approvalSteps, systemScope);
  const roleFor = (n: number) => (n === 1 ? 'hr' : 'admin') as AppRole;

  let made = 0;
  for (let n = 1; n <= levels; n++) {
    // Idempotently skip steps that have already been created.
    const existing = await steps.countDocuments({ request_id: requestId, step_no: n });
    if (existing > 0) {
      continue;
    }
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

// fn_provision_leave_balances

/**
 * Initializes annual paid leave (PL) balances for eligible employees,
 * computing annual entitlement plus carry-forward up to the configured cap.
 */
async function provisionLeaveBalances(
  args: { p_year?: number },
  invocation: Invocation = request,
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

  const employees = scopedFor<BaseDoc>(collections.employees, systemScope);
  const balances = scopedFor<BaseDoc>(collections.leaveBalances, systemScope);

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
    if (exists > 0) {
      // Idempotent skip if balance already exists
      continue;
    }

    const carried = Math.min(Math.max(previous.get(e._id as string) ?? 0, 0), cap);
    await balances.insertOne({
      _id: randomUUID(),
      employee_id: e._id,
      year,
      type: 'PL',
      // Leave tracked in half-day increments (0.5), stored as Decimal128.
      balance: toDecimal(Math.round((annual + carried) * 10) / 10),
      created_at: new Date(),
      updated_at: new Date(),
    });
    created++;
  }

  if (created > 0) {
    const log = scopedFor<BaseDoc>(collections.activityLog, systemScope);
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

let registered = false;

/** Wire the TypeScript implementations into the `.rpc()` surface. Idempotent. */
export function registerDbFunctions(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerRpc('fn_on_leave_today', () => onLeaveToday());
  registerRpc('fn_init_approval_steps', (a) => initApprovalSteps(a as { p_request_id?: string }));
  // RPC registration exposes only single-argument handlers to prevent caller tampering with
  // invocation context.
  registerRpc('fn_provision_leave_balances', (a) =>
    provisionLeaveBalances(a as { p_year?: number }),
  );
}

export { onLeaveToday, initApprovalSteps, provisionLeaveBalances };
