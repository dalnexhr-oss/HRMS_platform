import { NextResponse } from 'next/server';
import { getSession, isStaffRole } from '@/lib/server-auth';
import { canAccessTab } from '@/lib/portal-access';
import { getMyTabAccess } from '@/lib/server-queries';
import { readBoard } from '@/lib/tv-dashboard-data';

// Require staff access and fetch fresh attendance data for every board request.
export const dynamic = 'force-dynamic';

async function GET() {
  try {
    const { profile } = await getSession();
    if (!isStaffRole(profile?.role)) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }
    // Apply the page's tab-access gate to its data endpoint too.
    const access = await getMyTabAccess(profile?.id ?? null);
    if (!canAccessTab(profile?.role, 'tv-dashboard', access)) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }
    return NextResponse.json(await readBoard());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load the board.' },
      { status: 500 },
    );
  }
}

export { GET };
