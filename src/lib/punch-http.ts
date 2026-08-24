// Shared request handling for the punch in / punch out routes.
import { NextResponse, type NextRequest } from 'next/server';
import { LOCATION_REQUIRED, recordPunch, type PunchCoords, type PunchKind } from '@/lib/punch';

/**
 * Coordinates are OPTIONAL. A body with no usable lat/lng is not an error —
 * the browser may have denied permission or have no GPS at all — it just means
 * the punch is stored unclassified rather than at-office or off-site.
 */
function readCoords(body: unknown): PunchCoords | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
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
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unable to punch ${kind}.`;

    // A refusal for missing location gets its own code so the UI can show the
    // "unblock location" instructions rather than a generic failure.
    if (message === LOCATION_REQUIRED) {
      return NextResponse.json(
        { error: message, code: 'LOCATION_REQUIRED' },
        { status: 422 },
      );
    }
    // A sequence clash ("already punched in") is the caller's problem: 409.
    // Anything else here is a server or auth failure.
    const conflict = /already punched|no open punch/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
