import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api/route-handler';
import { readPunchStatus } from '@/lib/punch';

// Always live: a cached punch status would show a stale in/out state.
export const dynamic = 'force-dynamic';

const GET = apiRoute('GET /api/punch/status', async () =>
  NextResponse.json(await readPunchStatus()),
);

export { GET };
