// Browser-side wrappers for the /api/punch routes.
// Server work lives in @/lib/punch — this file only speaks HTTP.

export interface PunchStatusResponse {
  status: 'in' | 'out';
  lastPunchAt: string | null;
  lastKind: 'in' | 'out' | null;
  lastWithinGeofence: boolean | null;
  workedMinutes: number;
  geofenceConfigured: boolean;
  /** Server policy: refuse a punch that shares no location at all. */
  requireLocation: boolean;
}

export interface PunchRecord {
  type: 'in' | 'out';
  timestamp: string;
  withinGeofence: boolean | null;
}

export interface PunchResult {
  kind: 'in' | 'out';
  punchedAt: string;
  withinGeofence: boolean | null;
  workedMinutes: number;
}

/** Coordinates are optional everywhere — a punch without them is still valid. */
export interface PunchCoords {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

async function unwrap<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export function getPunchStatus(): Promise<PunchStatusResponse> {
  return fetch('/api/punch/status', { cache: 'no-store' }).then((response) =>
    unwrap<PunchStatusResponse>(response, 'Failed to fetch punch status.'),
  );
}

export function getPunchHistory(): Promise<{ punches: PunchRecord[] }> {
  return fetch('/api/punch/history', { cache: 'no-store' }).then((response) =>
    unwrap<{ punches: PunchRecord[] }>(response, 'Failed to fetch punch history.'),
  );
}

function punch(kind: 'in' | 'out', coords: PunchCoords | null): Promise<PunchResult> {
  return fetch(`/api/punch/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(coords ?? {}),
  }).then((response) => unwrap<PunchResult>(response, `Failed to punch ${kind}.`));
}

export function punchIn(coords: PunchCoords | null): Promise<PunchResult> {
  return punch('in', coords);
}

export function punchOut(coords: PunchCoords | null): Promise<PunchResult> {
  return punch('out', coords);
}

/** Why a location attempt produced nothing — each needs different wording. */
export type LocationFailure =
  /** The user (or a policy) refused the permission. Only they can undo it. */
  | 'denied'
  /** Permission is fine, the device just could not get a fix. Retryable. */
  | 'unavailable'
  /** Took too long. Retryable. */
  | 'timeout'
  /** No geolocation API, or a non-HTTPS origin, so it was never offered. */
  | 'unsupported';

export type LocationResult =
  | { ok: true; coords: PunchCoords }
  | { ok: false; reason: LocationFailure };

/**
 * Whether this browser will even show a prompt, WITHOUT triggering one.
 *
 * The Permissions API is what makes "location is blocked" visible up front. A
 * browser that has already been told no fires the error callback instantly and
 * silently, so without this check the UI cannot tell "blocked" from "the user
 * has not been asked yet" — which is exactly how a blocked punch looked like a
 * working one. Safari only shipped geolocation in permissions.query() late, so
 * an unsupported query degrades to 'prompt' and we find out on the attempt.
 */
export async function locationPermission(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  if (!navigator.permissions?.query) return 'prompt';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'prompt';
  }
}

/**
 * Ask for a fix, reporting WHY it failed rather than collapsing everything to
 * null. Must be called from a user gesture: browsers only raise the permission
 * prompt in response to one.
 */
export function requestCoords(timeoutMs = 10_000): Promise<LocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        }),
      (error) => {
        const reason: LocationFailure =
          error.code === error.PERMISSION_DENIED
            ? 'denied'
            : error.code === error.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        resolve({ ok: false, reason });
      },
      // maximumAge:0 — a punch must reflect where the person is NOW, not a
      // cached fix from when they were somewhere else.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
