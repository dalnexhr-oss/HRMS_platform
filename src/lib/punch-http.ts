// Shared request handling for the punch in / punch out routes.
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { locationRequired, recordPunch, type PunchCoords, type PunchKind } from '@/lib/punch';

// Pages a punch changes: the board and its punch log, the register, /me.
const affectedPaths = ['/today', '/register', '/me'];

// Missing coordinates are allowed here. Store the punch as unclassified if the browser cannot
// provide a usable location.
function readCoords(body: unknown): PunchCoords | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const accuracy = Number(record.accuracy);
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  };
}

export async function handlePunch(request: NextRequest, kind: PunchKind) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await recordPunch(kind, readCoords(body));
    // Only after the write actually succeeded — a refused or failed punch has
    // changed nothing, and invalidating on it would just cost everyone a
    // re-render to redisplay the same numbers.
    for (const path of affectedPaths) {
      revalidatePath(path);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unable to punch ${kind}.`;

    // A refusal for missing location gets its own code so the UI can show the
    // "unblock location" instructions rather than a generic failure.
    if (message === locationRequired) {
      return NextResponse.json({ error: message, code: 'LOCATION_REQUIRED' }, { status: 422 });
    }
    // A sequence clash ("already punched in") is the caller's problem: 409.
    // Anything else here is a server or auth failure.
    const conflict = /already punched|no open punch/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
