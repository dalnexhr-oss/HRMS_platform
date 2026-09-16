// Scoped aggregation views for attendance, celebrations, inventory, assets, and exits. Business-day
// filters use IST.

import 'server-only';
import type { Document } from 'mongodb';
import { collections } from '@/lib/db/collections';
import { scoped, scopedFor } from '@/lib/db/repo';
import type { Scope } from '@/lib/db/scope';
import { todayIST } from '@/lib/format';

// Returns a scoped collection handle. Defaults to active caller session scope.
async function handle(name: string, scope?: Scope) {
  return scope ? scopedFor(name, scope) : await scoped(name);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// v_today_board — headcount and attendance per branch, for today

async function todayBoard(scope?: Scope): Promise<Document[]> {
  const date = todayIST();
  const employees = await handle(collections.employees, scope);

  return employees.aggregate([
    { $match: { status: 'active' } },
    {
      // Correlate attendance records for the target date via pipeline lookup to preserve
      // employees without an attendance record (counted as absent).
      $lookup: {
        from: collections.attendanceDays,
        let: { eid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$employee_id', '$$eid'] }, { $eq: ['$work_date', date] }] },
            },
          },
          { $project: { status: 1 } },
        ],
        as: 'today',
      },
    },
    { $unwind: { path: '$today', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { $ifNull: ['$branch_name', 'Unassigned'] },
        headcount: { $sum: 1 },
        present: { $sum: { $cond: [{ $in: ['$today.status', ['P', 'LM']] }, 1, 0] } },
        field: { $sum: { $cond: [{ $in: ['$today.status', ['S', 'T']] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$today.status', 'AB'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, branch: '$_id', headcount: 1, present: 1, field: 1, absent: 1 } },
    { $sort: { branch: 1 } },
  ]);
}

// v_celebrations — birthdays and work anniversaries falling today

async function celebrations(scope?: Scope): Promise<Document[]> {
  const date = todayIST();
  // Match on MM-DD suffix directly against ISO date strings (YYYY-MM-DD).
  const mmdd = date.slice(5);
  const employees = await handle(collections.employees, scope);

  const rows = await employees.aggregate([
    {
      $match: {
        status: 'active',
        $or: [
          { date_of_birth: { $regex: `-${mmdd}$` } },
          { date_of_joining: { $regex: `-${mmdd}$` } },
        ],
      },
    },
    {
      $project: {
        full_name: 1,
        code: 1,
        date_of_birth: 1,
        date_of_joining: 1,
        branch: { $ifNull: ['$branch_name', null] },
        department: { $ifNull: ['$department_name', null] },
      },
    },
  ]);

  const year = Number(date.slice(0, 4));
  const out: Document[] = [];
  for (const e of rows) {
    if (typeof e.date_of_birth === 'string' && e.date_of_birth.endsWith(`-${mmdd}`)) {
      out.push({
        id: e._id,
        full_name: e.full_name,
        code: e.code,
        branch: e.branch,
        department: e.department,
        kind: 'birthday',
        years: 0,
      });
    }
    const doj = e.date_of_joining as string | undefined;
    // Exclude employees joining today (anniversary requires >= 1 complete year).
    if (typeof doj === 'string' && doj.endsWith(`-${mmdd}`) && doj < date) {
      out.push({
        id: e._id,
        full_name: e.full_name,
        code: e.code,
        branch: e.branch,
        department: e.department,
        kind: 'anniversary',
        years: year - Number(doj.slice(0, 4)),
      });
    }
  }
  return out;
}

// v_items — stock with assigned / remaining quantities

async function items(scope?: Scope): Promise<Document[]> {
  const repo = await handle(collections.items, scope);
  return repo.aggregate([
    {
      $lookup: {
        from: collections.itemAssignments,
        let: { iid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$item_id', '$$iid'] }, { $eq: ['$returned', false] }] },
            },
          },
          { $group: { _id: null, qty: { $sum: '$quantity' } } },
        ],
        as: 'out',
      },
    },
    {
      $addFields: {
        id: '$_id',
        quantity_assigned: { $ifNull: [{ $first: '$out.qty' }, 0] },
      },
    },
    {
      $addFields: {
        quantity_remaining: { $subtract: ['$total_quantity', '$quantity_assigned'] },
      },
    },
    { $project: { out: 0 } },
  ]);
}

// v_asset_summary — counts per category

async function assetSummary(scope?: Scope): Promise<Document[]> {
  const soon = addDays(todayIST(), 30);
  const repo = await handle(collections.assets, scope);

  return repo.aggregate([
    {
      $group: {
        _id: { $ifNull: ['$asset_category', 'Uncategorised'] },
        total: { $sum: 1 },
        assigned: { $sum: { $cond: [{ $ne: ['$assigned_employee_id', null] }, 1, 0] } },
        available: { $sum: { $cond: [{ $eq: ['$assigned_employee_id', null] }, 1, 0] } },
        warranty_expiring: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ['$warranty_upto', null] }, { $lte: ['$warranty_upto', soon] }] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        category: '$_id',
        total: 1,
        assigned: 1,
        available: 1,
        warranty_expiring: 1,
      },
    },
    { $sort: { category: 1 } },
  ]);
}

// v_exit_clearance_pending — what is still outstanding per exit case

async function exitClearancePending(scope?: Scope): Promise<Document[]> {
  const repo = await handle(collections.exitCases, scope);

  return repo.aggregate([
    {
      $lookup: {
        from: collections.assets,
        let: { eid: '$employee_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$assigned_employee_id', '$$eid'] } } },
          { $count: 'n' },
        ],
        as: 'assets',
      },
    },
    {
      $lookup: {
        from: collections.itemAssignments,
        let: { eid: '$employee_id' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$employee_id', '$$eid'] }, { $eq: ['$returned', false] }] },
            },
          },
          { $count: 'n' },
        ],
        as: 'issued',
      },
    },
    {
      $lookup: {
        from: collections.exitClearanceItems,
        let: { cid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$exit_case_id', '$$cid'] }, { $eq: ['$cleared', false] }] },
            },
          },
          { $count: 'n' },
        ],
        as: 'open',
      },
    },
    {
      $addFields: {
        exit_case_id: '$_id',
        assets_outstanding: { $ifNull: [{ $first: '$assets.n' }, 0] },
        items_outstanding: { $ifNull: [{ $first: '$issued.n' }, 0] },
        clearance_items_open: { $ifNull: [{ $first: '$open.n' }, 0] },
      },
    },
    {
      $addFields: {
        clearance_complete: {
          $eq: [
            { $add: ['$assets_outstanding', '$items_outstanding', '$clearance_items_open'] },
            0,
          ],
        },
      },
    },
    { $project: { assets: 0, issued: 0, open: 0 } },
  ]);
}

const views: Record<string, (scope?: Scope) => Promise<Document[]>> = {
  v_today_board: todayBoard,
  v_celebrations: celebrations,
  v_items: items,
  v_asset_summary: assetSummary,
  v_exit_clearance_pending: exitClearancePending,
};

export function isView(name: string): boolean {
  return name in views;
}

/**
 * Executes the named aggregation pipeline. Throws if the view name is unrecognized.
 *
 * @param name View identifier
 * @param scope Optional execution authorization scope (defaults to caller's session)
 */
export async function runView(name: string, scope?: Scope): Promise<Document[]> {
  const view = views[name];
  if (!view) throw new Error(`Unknown view '${name}'. Views live in src/lib/db/views.ts.`);
  return view(scope);
}
