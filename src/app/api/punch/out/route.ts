import type { NextRequest } from 'next/server';
import { handlePunch } from '@/lib/punch-http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handlePunch(request, 'out');
}
