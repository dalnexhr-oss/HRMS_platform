// ============================================================================
// Resolving the branch a holiday or a notice belongs to.
//
// Not an action — the leading underscore marks it as a helper, same as
// _guard.ts. It must NOT live in branches.ts: that file is 'use server', where
// every export becomes a callable endpoint.
//
// WHY BOTH HALVES ARE STORED
//
// branch_name is denormalised onto holidays and notices exactly as it is onto
// employees, so the list screens do not have to join. getHolidays() and
// getNotices() read `branch_name ?? null` with nothing to fall back on, and a
// null branch is the app's way of saying "every branch" — /me shows a holiday
// to everyone when `!h.branch`, and /api/calendar exports it into everyone's
// .ics. So a row written with only branch_id does not render as "unknown
// branch", it renders as company-wide, and a Pune-only holiday lands in a
// Vadodara employee's calendar.
//
// updateBranch() keeps these copies in step when a branch is renamed. Writing
// them here is the other half of that bargain.
// ============================================================================
import type { createClient } from '@/lib/db/server';

type DbClient = Awaited<ReturnType<typeof createClient>>;

/** The denormalised branch columns: an id and the canonical name beside it. */
export interface BranchScope {
  branch_id: string | null;
  branch_name: string | null;
}

/** Both columns for "all branches" — the shape an empty selection resolves to. */
export const ALL_BRANCHES: BranchScope = { branch_id: null, branch_name: null };

/**
 * Resolve a submitted branch name to the columns to store.
 *
 * The name is read back off the branch row rather than echoed from the form,
 * so 'pune' cannot be stored where the branch is really called 'Pune'. An
 * unknown name resolves to all-branches, which is what a blank selection means
 * and what these screens have always done with one.
 */
export async function resolveBranchScope(dbc: DbClient, branch: string): Promise<BranchScope> {
  const name = branch.trim();
  if (!name) return ALL_BRANCHES;
  const { data } = await dbc.from('branches').select('id, name').eq('name', name).maybeSingle();
  if (!data) return ALL_BRANCHES;
  return { branch_id: data.id, branch_name: data.name };
}
