'use server';

// ============================================================================
// Branch management (Settings screen). Branches are CREATED inline from the
// employee drawer (resolveBranch in employees.ts); this file is the other half
// — fixing a branch that was set up wrong (typoed name, wrong state) and
// removing one created by mistake.
//
// Deletion is guarded by the schema, not by us: employees.branch_id is
// `on delete restrict` (0001), so a branch with employees cannot be deleted —
// Postgres refuses with 23503 and we translate. Branch-scoped holidays and
// notices cascade away with it, which the confirm dialog warns about.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { INDIAN_STATES } from '@/lib/constants';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Everything that renders branch names or state-derived payroll figures. */
function revalidateBranchSurfaces(): void {
  revalidatePath('/settings');
  revalidatePath('/employees');
  revalidatePath('/holidays');
  revalidatePath('/notices');
  revalidatePath('/today');
}

/** Rename a branch and/or move it to another state. */
export async function updateBranch(id: string, formData: FormData): Promise<ActionResult> {
  const gate = await requireStaff('Updating a branch');
  if (!gate.ok) return gate;

  const name = String(formData.get('name') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  if (!id) return { ok: false, error: 'Which branch to update is missing.' };
  if (!name) return { ok: false, error: 'Enter the branch name.' };
  if (!(INDIAN_STATES as readonly string[]).includes(state)) {
    return { ok: false, error: 'Pick the branch state or union territory.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('branches')
    .update({ name, state })
    .eq('id', id)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `A branch named “${name}” already exists.` };
    }
    if (error.code === '22P02') {
      return {
        ok: false,
        error: `The database does not accept '${state}' as a state yet — apply migration 0040.`,
      };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The branch was not updated — it may be gone, or your role lacks permission.' };
  }

  revalidateBranchSurfaces();
  return { ok: true };
}

/**
 * Delete a branch. The employees FK (`on delete restrict`) makes this safe:
 * a branch that still has employees cannot be removed, only one that is empty
 * or was created by mistake.
 */
export async function deleteBranch(id: string): Promise<ActionResult> {
  const gate = await requireStaff('Deleting a branch');
  if (!gate.ok) return gate;
  if (!id) return { ok: false, error: 'Which branch to delete is missing.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('branches').delete().eq('id', id).select('id');

  if (error) {
    // FK restriction from employees.branch_id — the schema refusing, correctly.
    if (error.code === '23503') {
      return {
        ok: false,
        error: 'This branch still has employees. Move them to another branch first, then delete it.',
      };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The branch was not deleted — it may already be gone, or your role lacks permission.' };
  }

  revalidateBranchSurfaces();
  return { ok: true };
}
