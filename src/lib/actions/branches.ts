'use server';

/**
 * Branch actions. Block deletion while employees are assigned and propagate renamed branch labels
 * in a transaction.
 */
import { revalidatePath } from 'next/cache';
import { requireRoles } from '@/lib/actions/guards';
import { collections } from '@/lib/db/collections';
import { scoped } from '@/lib/db/repo';
import { States } from '@/lib/constants';
import { toCoordinate } from '@/lib/db/money';
import { withTransaction } from '@/lib/db/mongo';
import type { BranchDoc, EmployeeDoc } from '@/lib/db/collections';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const branchAdminRoles = ['super_admin', 'admin', 'hr'] as const;

// Everything that renders branch names or state-derived payroll figures.
function revalidateBranchSurfaces(): void {
  revalidatePath('/settings');
  revalidatePath('/employees');
  revalidatePath('/holidays');
  revalidatePath('/notices');
  revalidatePath('/today');
}

// Use the same fallback radius as db/defaults.ts. This required numeric field cannot be saved as
// null.
const defaultGeofenceRadiusM = 150;

/**
 * Update a branch's office location in one document. Require both coordinates or neither; clearing
 * them restores the company-wide fallback.
 */
export async function updateBranchLocation(id: string, formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(branchAdminRoles, 'Setting a branch office location');
  if (!gate.ok) {
    return gate;
  }
  if (!id) {
    return { ok: false, error: 'Which branch to update is missing.' };
  }

  const address = String(formData.get('address') ?? '').trim() || null;
  const latRaw = String(formData.get('geofence_lat') ?? '').trim();
  const lngRaw = String(formData.get('geofence_lng') ?? '').trim();
  const radiusRaw = String(formData.get('geofence_radius_m') ?? '').trim();

  if (Boolean(latRaw) !== Boolean(lngRaw)) {
    return { ok: false, error: 'Enter both the latitude and the longitude, or leave both blank.' };
  }

  let lat: number | null = null;
  let lng: number | null = null;
  if (latRaw && lngRaw) {
    lat = Number(latRaw);
    lng = Number(lngRaw);
    // Range-checked, not just parsed: a transposed pair (lng in the lat box) is
    // the ordinary mistake here, and 78.3 degrees north is a place — so the
    // check catches it only when the value is outside latitude's range at all.
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { ok: false, error: 'Latitude must be a number between -90 and 90.' };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, error: 'Longitude must be a number between -180 and 180.' };
    }
  }

  let radius = defaultGeofenceRadiusM;
  if (radiusRaw) {
    const parsed = Math.round(Number(radiusRaw));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: 'The radius must be a whole number of metres above zero.' };
    }
    radius = parsed;
  }

  try {
    const branches = await scoped<BranchDoc>(collections.branches);
    const matched = await branches.updateOne(
      { _id: id },
      {
        $set: {
          address,
          // toCoordinate, not toMoney: six decimal places rather than two. Two
          // would round the point to roughly the nearest kilometre, which is
          // wider than any office radius anyone would set.
          geofence_lat: toCoordinate(lat),
          geofence_lng: toCoordinate(lng),
          geofence_radius_m: radius,
        },
      },
    );
    if (matched === 0) {
      return {
        ok: false,
        error:
          'The office location was not saved — the branch may be gone, or your role lacks permission.',
      };
    }

    // /today and the employee dashboard read a punch's on-site stamp, which is
    // decided against this point from the next punch onward.
    revalidatePath('/settings');
    revalidatePath('/today');
    revalidatePath('/me');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not save the office location.',
    };
  }
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

// Rename a branch and/or move it to another state. Admin/HR, like /settings itself.
export async function updateBranch(id: string, formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(branchAdminRoles, 'Updating a branch');
  if (!gate.ok) {
    return gate;
  }

  const name = String(formData.get('name') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  if (!id) {
    return { ok: false, error: 'Which branch to update is missing.' };
  }
  if (!name) {
    return { ok: false, error: 'Enter the branch name.' };
  }
  if (!(States as readonly string[]).includes(state)) {
    return { ok: false, error: 'Pick the branch state or union territory.' };
  }

  try {
    // Open all collection handles inside the transaction callback and bind them to its session so
    // branch and cached names change together. Standalone MongoDB runs the writes without
    // atomicity.
    const matched = await withTransaction(async (session) => {
      const branches = await scoped<BranchDoc>(collections.branches, session);
      const employees = await scoped<EmployeeDoc>(collections.employees, session);

      const count = await branches.updateOne({ _id: id }, { $set: { name, state } });
      if (count === 0) {
        return 0;
      }
      // Every collection that keeps a copy of the branch name. Miss one and it
      // goes on showing a name the branch no longer has.
      await employees.updateMany({ branch_id: id }, { $set: { branch_name: name } });
      for (const c of [collections.holidays, collections.notices]) {
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

/** Delete a branch only when no employees reference it. */
export async function deleteBranch(id: string): Promise<ActionResult> {
  const gate = await requireRoles(branchAdminRoles, 'Deleting a branch');
  if (!gate.ok) {
    return gate;
  }
  if (!id) {
    return { ok: false, error: 'Which branch to delete is missing.' };
  }

  try {
    const employees = await scoped<EmployeeDoc>(collections.employees);
    // Counts employees in ANY status, deactivated ones included: their payslips
    // and attendance still reference this branch, so removing it would break
    // history as surely as it would break a live roster.
    const headcount = await employees.countDocuments({ branch_id: id }, { limit: 1 });
    if (headcount > 0) {
      return {
        ok: false,
        error:
          'This branch still has employees. Move them to another branch first, then delete it.',
      };
    }

    const branches = await scoped<BranchDoc>(collections.branches);
    const deleted = await branches.deleteOne({ _id: id });
    if (deleted === 0) {
      return {
        ok: false,
        error:
          'The branch was not deleted — it may already be gone, or your role lacks permission.',
      };
    }

    // Departments were `on delete set null`, so they survive with no branch
    // rather than disappearing — same as before.
    const departments = await scoped(collections.departments);
    await departments.updateMany({ branch_id: id }, { $set: { branch_id: null } });

    revalidateBranchSurfaces();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete the branch.' };
  }
}
