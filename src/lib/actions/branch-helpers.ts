// Resolve branch IDs and cached names for holidays and notices. Keep this helper outside use-server
// modules so it is not exposed as an action.
//
// Both fields must be written together: a missing branch name is displayed as company-wide.
// updateBranch refreshes cached names when a branch is renamed.
import type { createClient } from '@/lib/db/server-client';

type DbClient = Awaited<ReturnType<typeof createClient>>;

// The denormalised branch columns: an id and the canonical name beside it.
interface BranchScope {
  branch_id: string | null;
  branch_name: string | null;
}

// Both columns for "all branches" — the shape an empty selection resolves to.
const allBranches: BranchScope = { branch_id: null, branch_name: null };

// Resolve the canonical name from the branch record. Blank or unknown names retain the existing
// all-branches behavior.
async function resolveBranchScope(queryClient: DbClient, branch: string): Promise<BranchScope> {
  const name = branch.trim();
  if (!name) {
    return allBranches;
  }
  const { data } = await queryClient
    .from('branches')
    .select('id, name')
    .eq('name', name)
    .maybeSingle();
  if (!data) {
    return allBranches;
  }
  return { branch_id: data.id, branch_name: data.name };
}

export { allBranches, resolveBranchScope };
export type { BranchScope };
