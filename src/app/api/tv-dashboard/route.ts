import { NextResponse } from 'next/server';
import { ApiError, apiErrorCodes } from '@/lib/api/errors';
import { apiRoute, requireStaffSession } from '@/lib/api/route-handler';
import { canAccessTab } from '@/lib/portal-access';
import { getMyTabAccess } from '@/lib/queries/settings';
import { readBoard } from '@/lib/tv-dashboard-data';

// Require staff access and fetch fresh attendance data for every board request.
export const dynamic = 'force-dynamic';

const GET = apiRoute('GET /api/tv-dashboard', async () => {
  const profile = await requireStaffSession();
  // Apply the page's tab-access gate to its data endpoint too.
  const access = await getMyTabAccess(profile.id);
  if (!canAccessTab(profile.role, 'tv-dashboard', access)) {
    throw new ApiError(403, apiErrorCodes.forbidden, 'Not authorised.');
  }
  return NextResponse.json(await readBoard());
});

export { GET };
