// Resolve branch IDs and cached names for holidays and notices. Keep this helper outside use-server
// modules so it is not exposed as an action.
//
// Both fields must be written together: a missing branch name is displayed as company-wide.
// updateBranch refreshes cached names when a branch is renamed.
import type { createClient } from '@/lib/db/server';

type DbClient = Awaited<ReturnType<typeof createClient>>;

// The denormalised branch columns: an id and the canonical name beside it.
export interface BranchScope {
  branch_id: string | null;
  branch_name: string | null;
}

// Both columns for "all branches" — the shape an empty selection resolves to.
export const allBranches: BranchScope = { branch_id: null, branch_name: null };

// Resolve a submitted branch name to the columns to store. The name is read back off the branch row
// rather than echoed from the form, so 'pune' cannot be stored where the branch is really called
// 'Pune'. An unknown name resolves to all-branches, which is what a blank selection means and what
// these screens have always done with one.
export async function resolveBranchScope(dbc: DbClient, branch: string): Promise<BranchScope> {
  const name = branch.trim();
  if (!name) return allBranches;
  const { data } = await dbc.from('branches').select('id, name').eq('name', name).maybeSingle();
  if (!data) return allBranches;
  return { branch_id: data.id, branch_name: data.name };
}
