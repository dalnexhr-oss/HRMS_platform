// Browser-side wrappers for the /api/punch routes.
// Server work lives in @/lib/punch — this file only speaks HTTP, through the shared API client.

import { apiRequest, newIdempotencyKey } from '@/lib/api/client';
import type { PunchStatus as PunchStatusResponse, PunchRecord, PunchResult, PunchCoords } from '@/types/punch';

interface ReadOptions {
  signal?: AbortSignal;
}

function getPunchStatus(options: ReadOptions = {}): Promise<PunchStatusResponse> {
  return apiRequest<PunchStatusResponse>('/api/punch/status', {
    ...options,
    fallbackMessage: 'Failed to fetch punch status.',
  });
}

function getPunchHistory(options: ReadOptions = {}): Promise<{ punches: PunchRecord[] }> {
  return apiRequest<{ punches: PunchRecord[] }>('/api/punch/history', {
    ...options,
    fallbackMessage: 'Failed to fetch punch history.',
  });
}

/**
 * One press of the button is one punch. The key lets the client retry a lost response safely: the
 * server answers a repeat with the punch it already stored.
 */
function punch(kind: 'in' | 'out', coords: PunchCoords | null): Promise<PunchResult> {
  return apiRequest<PunchResult>(`/api/punch/${kind}`, {
    method: 'POST',
    body: coords ?? {},
    idempotencyKey: newIdempotencyKey(),
    // A punch is a transaction across several collections; give it longer than a read.
    timeoutMs: 20_000,
    fallbackMessage: `Failed to punch ${kind}.`,
  });
}

function punchIn(coords: PunchCoords | null): Promise<PunchResult> {
  return punch('in', coords);
}

function punchOut(coords: PunchCoords | null): Promise<PunchResult> {
  return punch('out', coords);
}

/** Why a location attempt produced nothing — each needs different wording. */
type LocationFailure =
  /** The user (or a policy) refused the permission. Only they can undo it. */
  | 'denied'
  /** Permission is fine, the device just could not get a fix. Retryable. */
  | 'unavailable'
  /** Took too long. Retryable. */
  | 'timeout'
  /** No geolocation API, or a non-HTTPS origin, so it was never offered. */
  | 'unsupported';

type LocationResult = { ok: true; coords: PunchCoords } | { ok: false; reason: LocationFailure };

/**
 * Read geolocation permission without prompting. If the browser does not support this query, return
 * prompt and let the location request determine the result.
 */
async function locationPermission(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }
  if (!navigator.permissions?.query) {
    return 'prompt';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'prompt';
  }
}

/** Request location from a user gesture and preserve the failure reason for the UI. */
function requestCoords(timeoutMs = 10_000): Promise<LocationResult> {
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
      // Require a fresh location fix for each punch.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export { getPunchStatus, getPunchHistory, punchIn, punchOut, locationPermission, requestCoords };

export type {
  PunchStatusResponse,
  PunchRecord,
  PunchResult,
  PunchCoords,
  LocationFailure,
  LocationResult,
};
