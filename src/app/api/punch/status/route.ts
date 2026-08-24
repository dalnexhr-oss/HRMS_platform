import { NextResponse } from 'next/server';
import { readPunchStatus } from '@/lib/punch';

// Always live: a cached punch status would show a stale in/out state.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readPunchStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load punch status.' },
      { status: 401 },
    );
  }
}
