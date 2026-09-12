'use server';

//
// Branch management (Settings screen). Branches are CREATED inline from the
// employee drawer (resolveBranch in employees.ts); this file is the other half
// — fixing a branch that was set up wrong (typoed name, wrong state) and
// removing one created by mistake.
//
// TWO THINGS THE PORT CHANGED, both because MongoDB has no foreign keys:
//
// 1. Deletion used to be blocked by `employees.branch_id … on delete restrict`
// — Postgres refused with 23503 and this file translated the error. Nothing
// refuses now, so the check is explicit and runs BEFORE the delete. Without
// it, deleting a branch would silently orphan every employee in it.
//
// 2. Renaming has to update employees.branch_name, which is denormalised onto
// each employee so list screens do not join. That copy is the price of the
// denormalisation, and forgetting it leaves the roster showing a name that
// no longer exists anywhere.
//
import { revalidatePath } from 'next/cache';
import { requireRoles } from '@/lib/actions/_guard';
import { collections, type BranchDoc, type EmployeeDoc } from '@/lib/db/collections';
import { scoped } from '@/lib/db/repo';
import { withTransaction } from '@/lib/db/mongo';
import { toCoordinate } from '@/lib/db/money';
import { States } from '@/lib/constants';

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

// Fallback radius for a branch whose office is set without one. Matches the
// column default in lib/db/defaults.ts; the column is NOT NULL, so a blank
// field has to resolve to a number rather than to null.
const defaultGeofenceRadiusM = 150;

/**
 * Set (or clear) one branch's OFFICE LOCATION.
 *
 * Separate from updateBranch, which renames a branch and has to keep the
 * denormalised copies of that name in step across four collections. Nothing is
 * denormalised here: a coordinate is read only by the punch classifier, so this
 * is a single-document write and needs no transaction.
 *
 * Latitude and longitude move TOGETHER. A branch with one and not the other
 * cannot be measured against, so a half-filled pair is refused rather than
 * stored — and clearing both is how a branch goes back to the company-wide
 * office_lat / office_lng settings.
 */
export async function updateBranchLocation(id: string, formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(branchAdminRoles, 'Setting a branch office location');
  if (!gate.ok) return gate;
  if (!id) return { ok: false, error: 'Which branch to update is missing.' };

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
        error: 'The office location was not saved — the branch may be gone, or your role lacks permission.',
      };
    }

    // /today and the employee dashboard read a punch's on-site stamp, which is
    // decided against this point from the next punch onward.
    revalidatePath('/settings');
    revalidatePath('/today');
    revalidatePath('/me');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the office location.' };
  }
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

// Rename a branch and/or move it to another state. Admin/HR, like /settings itself.
export async function updateBranch(id: string, formData: FormData): Promise<ActionResult> {
  const gate = await requireRoles(branchAdminRoles, 'Updating a branch');
  if (!gate.ok) return gate;

  const name = String(formData.get('name') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  if (!id) return { ok: false, error: 'Which branch to update is missing.' };
  if (!name) return { ok: false, error: 'Enter the branch name.' };
  if (!(States as readonly string[]).includes(state)) {
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
      const branches = await scoped<BranchDoc>(collections.branches, session);
      const employees = await scoped<EmployeeDoc>(collections.employees, session);

      const count = await branches.updateOne({ _id: id }, { $set: { name, state } });
      if (count === 0) return 0;
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

/**
 * Delete a branch.
 *
 * Safe only because of the headcount check below: it is what used to be
 * `on delete restrict` on employees.branch_id. A branch that still has
 * employees cannot be removed, only one that is empty or was created by
 * mistake.
 */
export async function deleteBranch(id: string): Promise<ActionResult> {
  const gate = await requireRoles(branchAdminRoles, 'Deleting a branch');
  if (!gate.ok) return gate;
  if (!id) return { ok: false, error: 'Which branch to delete is missing.' };

  try {
    const employees = await scoped<EmployeeDoc>(collections.employees);
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

    const branches = await scoped<BranchDoc>(collections.branches);
    const deleted = await branches.deleteOne({ _id: id });
    if (deleted === 0) {
      return {
        ok: false,
        error: 'The branch was not deleted — it may already be gone, or your role lacks permission.',
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
