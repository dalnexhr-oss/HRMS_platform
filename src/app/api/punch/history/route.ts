import { NextResponse } from 'next/server';
import { readPunchHistory } from '@/lib/punch';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ punches: await readPunchHistory() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load punch history.' },
      { status: 401 },
    );
  }
}
