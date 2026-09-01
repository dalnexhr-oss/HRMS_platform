'use server';

// ============================================================================
// Branch management (Settings screen). Branches are CREATED inline from the
// employee drawer (resolveBranch in employees.ts); this file is the other half
// — fixing a branch that was set up wrong (typoed name, wrong state) and
// removing one created by mistake.
//
// TWO THINGS THE PORT CHANGED, both because MongoDB has no foreign keys:
//
//  1. Deletion used to be blocked by `employees.branch_id … on delete restrict`
//     — Postgres refused with 23503 and this file translated the error. Nothing
//     refuses now, so the check is explicit and runs BEFORE the delete. Without
//     it, deleting a branch would silently orphan every employee in it.
//
//  2. Renaming has to update employees.branch_name, which is denormalised onto
//     each employee so list screens do not join. That copy is the price of the
//     denormalisation, and forgetting it leaves the roster showing a name that
//     no longer exists anywhere.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { requireRoles } from '@/lib/actions/_guard';
import { COLLECTIONS, type BranchDoc, type EmployeeDoc } from '@/lib/db/collections';
import { scoped } from '@/lib/db/repo';
import { withTransaction } from '@/lib/db/mongo';
import { INDIAN_STATES } from '@/lib/constants';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const BRANCH_ADMIN_ROLES = ['super_admin', 'admin', 'hr'] as const;

/** Everything that renders branch names or state-derived payroll figures. */
function revalidateBranchSurfaces(): void {
  revalidatePath('/settings');
  revalidatePath('/employees');
  revalidatePath('/holidays');
  revalidatePath('/notices');
  revalidatePath('/today');
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

/** Rename a branch and/or move it to another state. Admin/HR, like /settings itself. */
export async function updateBranch(id: string, formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(BRANCH_ADMIN_ROLES, 'Updating a branch');
  if (!gate.ok) return gate;

  const name = String(formData.get('name') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  if (!id) return { ok: false, error: 'Which branch to update is missing.' };
  if (!name) return { ok: false, error: 'Enter the branch name.' };
  if (!(INDIAN_STATES as readonly string[]).includes(state)) {
    return { ok: false, error: 'Pick the branch state or union territory.' };
  }

  try {
    // The rename and the denormalised copies must land together, or the roster
    // shows a name the branch no longer has. On a standalone mongod this still
    // runs, just not atomically — withTransaction says so once, loudly.
    //
    // Every handle is opened INSIDE the callback and bound to the session. They
    // used to be opened outside and the session ignored, so all four writes ran
    // on the normal pool: the transaction wrapped nothing and a failure midway
    // left the copies permanently disagreeing with the branch.
    const matched = await withTransaction(async (session) => {
      const branches = await scoped<BranchDoc>(COLLECTIONS.branches, session);
      const employees = await scoped<EmployeeDoc>(COLLECTIONS.employees, session);

      const count = await branches.updateOne({ _id: id }, { $set: { name, state } });
      if (count === 0) return 0;
      // Every collection that keeps a copy of the branch name. Miss one and it
      // goes on showing a name the branch no longer has.
      await employees.updateMany({ branch_id: id }, { $set: { branch_name: name } });
      for (const c of [COLLECTIONS.holidays, COLLECTIONS.notices]) {
        const repo = await scoped(c, session);
        await repo.updateMany({ branch_id: id }, { $set: { branch_name: name } });
      }
      return count;
    });

    if (matched === 0) {
      return {
        ok: false,
        error: 'The branch was not updated — it may be gone, or your role lacks permission.',
      };
    }

    revalidateBranchSurfaces();
    return { ok: true };
  } catch (e) {
    if (isDuplicateKey(e)) {
      return { ok: false, error: `A branch named “${name}” already exists.` };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update the branch.' };
  }
}

/**
 * Delete a branch.
 *
 * Safe only because of the headcount check below: it is what used to be
 * `on delete restrict` on employees.branch_id. A branch that still has
 * employees cannot be removed, only one that is empty or was created by
 * mistake.
 */
export async function deleteBranch(id: string): Promise<ActionResult> {
  const gate = await requireRoles(BRANCH_ADMIN_ROLES, 'Deleting a branch');
  if (!gate.ok) return gate;
  if (!id) return { ok: false, error: 'Which branch to delete is missing.' };

  try {
    const employees = await scoped<EmployeeDoc>(COLLECTIONS.employees);
    // Counts employees in ANY status, deactivated ones included: their payslips
    // and attendance still reference this branch, so removing it would break
    // history as surely as it would break a live roster.
    const headcount = await employees.countDocuments({ branch_id: id }, { limit: 1 });
    if (headcount > 0) {
      return {
        ok: false,
        error: 'This branch still has employees. Move them to another branch first, then delete it.',
      };
    }

    const branches = await scoped<BranchDoc>(COLLECTIONS.branches);
    const deleted = await branches.deleteOne({ _id: id });
    if (deleted === 0) {
      return {
        ok: false,
        error: 'The branch was not deleted — it may already be gone, or your role lacks permission.',
      };
    }

    // Departments were `on delete set null`, so they survive with no branch
    // rather than disappearing — same as before.
    const departments = await scoped(COLLECTIONS.departments);
    await departments.updateMany({ branch_id: id }, { $set: { branch_id: null } });

    revalidateBranchSurfaces();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete the branch.' };
  }
}
