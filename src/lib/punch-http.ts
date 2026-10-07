// Shared request handling for the punch in / punch out routes.
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordPunch } from '@/lib/punch';
import { ApiError, apiErrorCodes } from '@/lib/api/errors';
import { readJsonObject, requireEmployeeSession } from '@/lib/api/route-handler';
import type { PunchCoords, PunchKind } from '@/lib/punch';

// Pages a punch changes: the board and its punch log, the register, /employee.
const affectedPaths = ['/dashboard', '/monthly-register', '/employee', '/employee/attendance'];

const idempotencyKeyPattern = /^[A-Za-z0-9_-]{16,64}$/;

function invalid(message: string): ApiError {
  return new ApiError(422, apiErrorCodes.validationFailed, message);
}

/**
 * Missing coordinates are allowed: the punch is stored unclassified, or refused by the location
 * policy. Coordinates that are present must be real ones — a malformed pair is a client fault, not
 * a punch to store without a location.
 */
function readCoords(body: Record<string, unknown>): PunchCoords | null {
  const { latitude, longitude, accuracy } = body;
  if (latitude == null && longitude == null) {
    return null;
  }
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw invalid('The latitude sent with this punch is not valid.');
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw invalid('The longitude sent with this punch is not valid.');
  }
  if (
    accuracy != null &&
    (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0)
  ) {
    throw invalid('The location accuracy sent with this punch is not valid.');
  }
  return { latitude, longitude, accuracy: accuracy ?? null };
}

function readIdempotencyKey(request: Request): string | null {
  const key = request.headers.get('idempotency-key');
  if (key === null) {
    return null;
  }
  if (!idempotencyKeyPattern.test(key)) {
    throw invalid('The Idempotency-Key header is not valid.');
  }
  return key;
}

/**
 * Who is asking comes first, so an unauthenticated caller learns nothing from validation errors.
 * Punch access and the attendance rules are enforced inside recordPunch. Failures are thrown.
 */
async function handlePunch(request: Request, kind: PunchKind) {
  const context = await requireEmployeeSession();
  const requestKey = readIdempotencyKey(request);
  const coords = readCoords(await readJsonObject(request));
  const result = await recordPunch(kind, coords, requestKey, context);
  // Only after the write actually succeeded — a refused or failed punch has
  // changed nothing, and invalidating on it would just cost everyone a
  // re-render to redisplay the same numbers.
  for (const path of affectedPaths) {
    revalidatePath(path);
  }
  return NextResponse.json(result);
}

export { handlePunch };
