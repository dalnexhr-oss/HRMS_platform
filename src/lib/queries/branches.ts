import 'server-only';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { numberOrNull } from '@/lib/queries/shared';
import type { BranchDoc } from '@/lib/db/collection-registry';

// branches
interface BranchRow {
  id: string;
  name: string;
  state: string;
  // Branch location and radius classify punches without blocking off-site work. Missing
  // coordinates fall back to company geofence settings.
  address: string | null;
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadiusM: number | null;
}

/** All branches, alphabetical. */
async function getBranches(): Promise<BranchRow[]> {
  const branches = await scoped<BranchDoc>(collections.branches);
  const rows = await branches.find(
    {},
    {
      projection: {
        name: 1,
        state: 1,
        address: 1,
        geofence_lat: 1,
        geofence_lng: 1,
        geofence_radius_m: 1,
      },
      sort: { name: 1 },
    },
  );
  return rows.map((b) => ({
    id: b._id,
    name: b.name,
    state: b.state,
    address: b.address ?? null,
    // Convert Decimal128 coordinates to numbers before passing them to client form fields.
    geofenceLat: numberOrNull(b.geofence_lat),
    geofenceLng: numberOrNull(b.geofence_lng),
    geofenceRadiusM: numberOrNull(b.geofence_radius_m),
  }));
}

export { getBranches };

export type { BranchRow };
