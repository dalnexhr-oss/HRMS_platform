// Record immutable punch_events and rebuild the day's attendance_days summary after each punch so
// multiple work sessions are included.
//
// Location classifies punches for HR review. Use the employee's branch geofence, falling back to
// company settings when the branch has no location.
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { toCoordinate } from '@/lib/db/money';
import type { PunchKind, PunchCoords, PunchStatus, PunchRecord, PunchResult } from '@/types/punch';
import { lastNightSweepNotice, previousWorkDate, type SweepClosure } from '@/lib/night-sweep';

const businessTimeZone = 'Asia/Kolkata';

// Fallback radius when an office point is set without one. A branch's own
// geofence_radius_m, or the geofence_radius_m setting, overrides it.
const defaultGeoRadius = 100;

export type { PunchKind, PunchCoords, PunchStatus, PunchRecord, PunchResult } from '@/types/punch';

// time helpers --

// Today's date and wall-clock time in the business timezone, not the server's.
function localParts(date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
  };
}

/** 'HH:MM:SS' -> minutes since midnight. */
function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Query from the preceding UTC day, then apply the exact business-day filter with localParts().
 * This includes early IST punches. Return a Date because punched_at is stored as BSON date, not a
 * string.
 */
export function dayFloorUtc(date: string): Date {
  const floor = new Date(`${date}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - 1);
  return floor;
}

// geofencing --

/**
 * Great-circle distance in metres. The haversine formula rather than a flat
 * approximation — at a 50m radius the difference is immaterial, but this stays
 * correct if the radius is ever widened to cover a campus.
 */
export function distanceMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadiusM = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** settings.value is jsonb, so a number may arrive as 50 or as "50". */
function numericSetting(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/^"|"$/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface OfficeGeofence {
  latitude: number;
  longitude: number;
  radiusM: number;
}

/** Thrown when a punch arrives with no location and the policy demands one. */
export const locationRequired =
  'Location is required to punch. Allow location access for this site, then try again.';

export interface PunchPolicy {
  office: OfficeGeofence | null;
  /**
   * Require coordinates when enabled. Enforce this on the server; an off-site location remains a
   * valid punch.
   */
  requireLocation: boolean;
}

/** settings.value is jsonb: true, "true" and 'true' all have to mean true. */
function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.replace(/^"|"$/g, '').toLowerCase();
    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }
  }
  return fallback;
}

/**
 * Read the employee's branch geofence. Missing configuration or lookup failures return null so the
 * caller can use the company-wide fallback.
 */
async function readBranchGeofence(employeeId: string): Promise<OfficeGeofence | null> {
  try {
    const dbc = await createClient();
    // `id` is selected only so the projection is narrowed to it plus the embed
    // — an empty field list means "no $project", i.e. the whole employee
    // document, which this has no use for.
    const { data, error } = await dbc
      .from('employees')
      .select('id, branches(geofence_lat, geofence_lng, geofence_radius_m)')
      .eq('id', employeeId)
      .maybeSingle();
    if (error || !data) {
      return null;
    }

    const branch = (data as { branches?: Record<string, unknown> | null }).branches;
    if (!branch) {
      return null;
    }

    // finite(), because the columns are `decimal` and come back as Decimal128 —
    // neither a number nor a string, so a plain typeof test drops every one.
    const latitude = finite(branch.geofence_lat);
    const longitude = finite(branch.geofence_lng);
    // Both or neither: a branch with one coordinate cannot be measured against.
    if (latitude == null || longitude == null) {
      return null;
    }

    const radius = finite(branch.geofence_radius_m);
    return {
      latitude,
      longitude,
      radiusM: radius != null && radius > 0 ? radius : defaultGeoRadius,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the branch geofence when employeeId is supplied, otherwise use the company location.
 * requireLocation is a company-wide policy in either case.
 */
export async function readPunchPolicy(employeeId?: string | null): Promise<PunchPolicy> {
  const dbc = await createClient();
  const [settings, branchOffice] = await Promise.all([
    dbc
      .from('settings')
      .select('key, value')
      .in('key', ['office_lat', 'office_lng', 'geofence_radius_m', 'punch_require_location']),
    employeeId ? readBranchGeofence(employeeId) : Promise.resolve(null),
  ]);
  const { data, error } = settings;
  // Fail CLOSED on a settings read error: defaulting to "location optional"
  // would quietly turn the requirement off the moment the table hiccups.
  if (error) {
    return { office: branchOffice, requireLocation: true };
  }

  const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
  const requireLocation = booleanSetting(byKey.get('punch_require_location'), true);

  // The branch's own office wins. It is the more specific answer, and it is the
  // one a punch at that branch has to be measured against.
  if (branchOffice) {
    return { office: branchOffice, requireLocation };
  }

  const latitude = numericSetting(byKey.get('office_lat'));
  const longitude = numericSetting(byKey.get('office_lng'));
  if (latitude == null || longitude == null) {
    return { office: null, requireLocation };
  }

  const radius = numericSetting(byKey.get('geofence_radius_m'));
  return {
    office: {
      latitude,
      longitude,
      radiusM: radius != null && radius > 0 ? radius : defaultGeoRadius,
    },
    requireLocation,
  };
}

/** The office point that applies to one employee, or null when none is set. */
export async function readOfficeGeofence(
  employeeId?: string | null,
): Promise<OfficeGeofence | null> {
  return (await readPunchPolicy(employeeId)).office;
}

/**
 * Return true inside the fence, false outside, and null when coordinates or office configuration
 * are unavailable. Null must not be recorded as off-site.
 */
function classify(coords: PunchCoords | null, office: OfficeGeofence | null): boolean | null {
  if (!coords || !office) {
    return null;
  }
  const metres = distanceMetres(
    coords.latitude,
    coords.longitude,
    office.latitude,
    office.longitude,
  );
  // A phone's own accuracy circle is folded into the allowance, otherwise a
  // 40m-accurate fix taken at the front desk reads as off-site.
  const slack = Math.min(coords.accuracy ?? 0, 100);
  return metres <= office.radiusM + slack;
}

// context --

async function employeeContext() {
  const { profile } = await getSession();
  if (!profile?.employee_id) {
    throw new Error('Your login is not linked to an employee record.');
  }
  return { profile, employeeId: profile.employee_id };
}

/** Normalize stored coordinates to finite numbers for client display and map links. */
function finite(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  // Decimal128 is an object; convert through its string value before checking finiteness.
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function validCoords(coords: PunchCoords | null): PunchCoords | null {
  if (!coords) {
    return null;
  }
  const { latitude, longitude } = coords;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return null;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  return coords;
}

// reads --

export async function readPunchStatus(): Promise<PunchStatus> {
  const { employeeId } = await employeeContext();
  const dbc = await createClient();
  const now = new Date();
  const today = localParts(now).date;

  const [events, policy, previousDay] = await Promise.all([
    dbc
      .from('punch_events')
      .select<DayEvent[]>('kind, punched_at, within_geofence, lat, lng')
      .eq('employee_id', employeeId)
      .gte('punched_at', dayFloorUtc(today))
      .order('punched_at', { ascending: true }),
    readPunchPolicy(employeeId),
    dbc
      .from('attendance_days')
      .select('work_date, punch_in, punch_out, auto_close_source, auto_closed_at')
      .eq('employee_id', employeeId)
      .eq('work_date', previousWorkDate(today))
      .maybeSingle<SweepClosure>(),
  ]);
  if (events.error) {
    throw new Error(events.error.message);
  }
  if (previousDay.error) {
    throw new Error(previousDay.error.message);
  }

  // Filter in the business timezone: the >= bound above is a coarse cut in UTC,
  // which for IST (UTC+5:30) can drag in the tail of the previous local day.
  const todays = (events.data ?? []).filter((event) => localParts(punchedAt(event)).date === today);
  const last = todays[todays.length - 1] ?? null;

  return {
    status: last?.kind === 'in' ? 'in' : 'out',
    // ISO string, not the raw column: PunchStatus crosses into a client
    // component, and a Date there is not the string the UI formats.
    lastPunchAt: last ? punchedAt(last).toISOString() : null,
    lastKind: (last?.kind as PunchKind | undefined) ?? null,
    lastWithinGeofence: last?.within_geofence ?? null,
    lastLat: finite(last?.lat),
    lastLng: finite(last?.lng),
    workedMinutes: sumWorkedMinutes(todays),
    geofenceConfigured: policy.office != null,
    requireLocation: policy.requireLocation,
    lastNightSweep: lastNightSweepNotice(previousDay.data, now),
  };
}

export async function readPunchHistory(): Promise<PunchRecord[]> {
  const { employeeId } = await employeeContext();
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('punch_events')
    .select<DayEvent[]>('kind, punched_at, within_geofence, lat, lng')
    .eq('employee_id', employeeId)
    .order('punched_at', { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((punch) => ({
    type: punch.kind as PunchKind,
    timestamp: punchedAt(punch).toISOString(),
    withinGeofence: punch.within_geofence ?? null,
    // numeric(9,6) comes back as a number, but a string would silently break
    // the map link — coerce and drop anything that is not a finite number.
    lat: finite(punch.lat),
    lng: finite(punch.lng),
  }));
}

// write --

/**
 * Punch queries always select kind and punched_at. Status and history queries also select optional
 * location fields.
 */
interface DayEvent {
  kind: string;
  /**
   * Timestamp stored as BSON Date (or legacy ISO string representation).
   * Parsed via punchedAt() for uniform handling.
   */
  punched_at: Date | string;
  within_geofence?: boolean | null;
  lat?: number | null;
  lng?: number | null;
}

/** Normalize either stored timestamp form for both punch processing and the TV board. */
export function punchInstant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The event's instant. */
function punchedAt(event: DayEvent): Date {
  return punchInstant(event.punched_at);
}

/**
 * Pair the day's events into sessions and total them. Only CLOSED sessions
 * count — an open punch-in contributes nothing until it is closed, so the
 * register never shows time that has not been worked yet.
 */
function sumWorkedMinutes(events: DayEvent[]): number {
  let total = 0;
  let openedAt: string | null = null;
  for (const event of events) {
    const clock = localParts(punchedAt(event)).time;
    if (event.kind === 'in') {
      // Consecutive 'in' events keep the earliest — a double tap must not
      // restart the session and silently drop the elapsed time.
      openedAt ??= clock;
    } else if (event.kind === 'out' && openedAt) {
      total += Math.max(0, toMinutes(clock) - toMinutes(openedAt));
      openedAt = null;
    }
  }
  return total;
}

export async function recordPunch(
  kind: PunchKind,
  coords: PunchCoords | null,
): Promise<PunchResult> {
  const { employeeId } = await employeeContext();
  const dbc = await createClient();
  const now = new Date();
  const { date } = localParts(now);

  // reject only genuine sequence errors, never a location
  const { data: priorRaw, error: priorError } = await dbc
    .from('punch_events')
    .select<DayEvent[]>('kind, punched_at')
    .eq('employee_id', employeeId)
    .gte('punched_at', dayFloorUtc(date))
    .order('punched_at', { ascending: true });
  if (priorError) {
    throw new Error(priorError.message);
  }

  const prior = (priorRaw ?? []).filter((event) => localParts(punchedAt(event)).date === date);
  const openNow = prior.length > 0 && prior[prior.length - 1].kind === 'in';

  if (kind === 'in' && openNow) {
    throw new Error('You are already punched in.');
  }
  if (kind === 'out' && !openNow) {
    throw new Error('There is no open punch to close.');
  }

  const point = validCoords(coords);
  const { office, requireLocation } = await readPunchPolicy(employeeId);

  // A required location must be present; being outside the office does not block a punch.
  if (requireLocation && !point) {
    throw new Error(locationRequired);
  }

  const withinGeofence = classify(point, office);

  const { error: eventError } = await dbc.from('punch_events').insert({
    employee_id: employeeId,
    // Stored as BSON Date matching collection schema validation.
    punched_at: now,
    kind,
    // Geographic coordinates stored as 6-decimal Decimal128.
    lat: toCoordinate(point?.latitude ?? null),
    lng: toCoordinate(point?.longitude ?? null),
    within_geofence: withinGeofence,
    source: 'web_app',
  });
  if (eventError) {
    throw new Error(eventError.message);
  }

  const workedMinutes = await resolveDay(employeeId, date, [...prior, { kind, punched_at: now }]);

  return { kind, punchedAt: now.toISOString(), withinGeofence, workedMinutes };
}

/**
 * Rebuild the attendance summary from the day's events. Preserve HR-set statuses; only missing or
 * AB attendance becomes P after a punch.
 */
async function resolveDay(
  employeeId: string,
  workDate: string,
  events: DayEvent[],
): Promise<number> {
  const dbc = await createClient();

  // Store punch times as HH:MM to match the attendance validator. Worked-minute calculations
  // already ignore seconds.
  const times = events.map((event) => ({
    kind: event.kind,
    clock: localParts(punchedAt(event)).time.slice(0, 5),
  }));
  const firstIn = times.find((event) => event.kind === 'in')?.clock ?? null;
  const lastOut = [...times].reverse().find((event) => event.kind === 'out')?.clock ?? null;
  const workedMinutes = sumWorkedMinutes(events);

  const { data: existing } = await dbc
    .from('attendance_days')
    .select('status')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .maybeSingle();

  const status = !existing?.status || existing.status === 'AB' ? 'P' : existing.status;

  const { error } = await dbc.from('attendance_days').upsert(
    {
      employee_id: employeeId,
      work_date: workDate,
      status,
      punch_in: firstIn,
      punch_out: lastOut,
      worked_minutes: workedMinutes,
      auto_close_source: null,
      auto_closed_at: null,
    },
    { onConflict: 'employee_id,work_date' },
  );
  if (error) {
    throw new Error(error.message);
  }
  return workedMinutes;
}
