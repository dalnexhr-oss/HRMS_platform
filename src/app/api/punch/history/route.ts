import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api/route-handler';
import { readPunchHistory } from '@/lib/punch';

export const dynamic = 'force-dynamic';

const GET = apiRoute('GET /api/punch/history', async () =>
  NextResponse.json({ punches: await readPunchHistory() }),
);

export { GET };
