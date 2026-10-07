// Shared plumbing for /api route handlers: session and role guards, request-body validation, and
// one place that turns a thrown error into the { error, code, requestId } response.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession, isStaffRole } from '@/lib/server-auth';
import { isMongoConfigured } from '@/lib/db/mongodb-connection';
import { ApiError, apiErrorCodes, codeForStatus, notSignedInMessage } from '@/lib/api/errors';
import type { ApiErrorBody, ApiErrorCode } from '@/lib/api/errors';
import type { Profile } from '@/types/database';

// Driver errors that mean "the database cannot be reached", as opposed to a bug in a query.
const unreachableDatabase = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

function errorResponse(
  status: number,
  message: string,
  code: ApiErrorCode = codeForStatus(status),
  requestId?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: message, code, ...(requestId ? { requestId } : {}) },
    { status },
  );
}

/**
 * Map a thrown value to a response. Only ApiError messages reach the client; anything else is
 * logged with the request id and reported in general terms, so driver and stack details stay on
 * the server.
 */
function failureResponse(error: unknown, route: string, requestId: string): NextResponse {
  if (error instanceof ApiError) {
    return errorResponse(error.status, error.message, error.code, requestId);
  }
  const name = error instanceof Error ? error.name : '';
  if (unreachableDatabase.has(name)) {
    console.error(`[api] ${route} ${requestId}: database unreachable (${name})`);
    return errorResponse(
      503,
      'The database is not reachable right now. Try again in a moment.',
      apiErrorCodes.unavailable,
      requestId,
    );
  }
  console.error(`[api] ${route} ${requestId} failed:`, error);
  return errorResponse(
    500,
    'Something went wrong on the server. Try again, and contact an administrator if it continues.',
    apiErrorCodes.internal,
    requestId,
  );
}

/**
 * Wrap a route handler so every exit — returned or thrown — carries a request id and timing, and
 * every failure has the same body shape.
 */
function apiRoute<Args extends unknown[]>(
  route: string,
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    const requestId = randomUUID();
    const started = performance.now();
    let response: Response;
    try {
      response = await handler(request, ...args);
    } catch (error) {
      response = failureResponse(error, route, requestId);
    }
    try {
      response.headers.set('x-request-id', requestId);
      response.headers.set('server-timing', `app;dur=${(performance.now() - started).toFixed(1)}`);
    } catch {
      // Some responses (redirects) have immutable headers; the body is still correct.
    }
    return response;
  };
}

/** The signed-in profile. A missing, revoked or disabled session is a 401. */
async function requireSession(): Promise<Profile> {
  if (!isMongoConfigured()) {
    throw new ApiError(503, apiErrorCodes.unavailable, 'The database is not configured.');
  }
  const { profile } = await getSession();
  if (!profile) {
    throw new ApiError(401, apiErrorCodes.notSignedIn, notSignedInMessage);
  }
  return profile;
}

/** A signed-in super admin, admin or HR account. */
async function requireStaffSession(): Promise<Profile> {
  const profile = await requireSession();
  if (!isStaffRole(profile.role)) {
    throw new ApiError(403, apiErrorCodes.forbidden, 'Not authorised.');
  }
  return profile;
}

/** A signed-in account that is linked to an employee record. */
async function requireEmployeeSession(): Promise<{ profile: Profile; employeeId: string }> {
  const profile = await requireSession();
  if (!profile.employee_id) {
    throw new ApiError(
      403,
      apiErrorCodes.noEmployeeRecord,
      'Your login is not linked to an employee record.',
    );
  }
  return { profile, employeeId: profile.employee_id };
}

/**
 * Read a small JSON object body. An empty body is an empty object; anything else must be JSON, an
 * object, and within the size limit.
 */
async function readJsonObject(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, apiErrorCodes.payloadTooLarge, 'The request is too large.');
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, apiErrorCodes.payloadTooLarge, 'The request is too large.');
  }
  if (!text.trim()) {
    return {};
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, apiErrorCodes.unsupportedMediaType, 'Send the request as JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, apiErrorCodes.badRequest, 'The request is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, apiErrorCodes.badRequest, 'The request must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export {
  apiRoute,
  errorResponse,
  readJsonObject,
  requireEmployeeSession,
  requireSession,
  requireStaffSession,
};
