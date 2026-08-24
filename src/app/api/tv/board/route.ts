import { NextResponse } from 'next/server';
import { getSession, isStaffRole } from '@/lib/auth';
import { canAccessTab } from '@/lib/access';
import { getMyTabAccess } from '@/lib/queries';
import { readBoard } from '@/lib/tv';

// The board is the whole floor's live whereabouts — staff only, and never
// cached: a prerendered board would freeze the day it was built.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { profile } = await getSession();
    if (!isStaffRole(profile?.role)) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }
    // Same gate as the page: revoking the tab has to close the data behind it,
    // not just the link to it.
    const access = await getMyTabAccess(profile?.id ?? null);
    if (!canAccessTab(profile?.role, 'tv', access)) {
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
