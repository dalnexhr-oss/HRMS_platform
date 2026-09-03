// ============================================================================
// Live punch in / punch out — server side.
//
// Two tables are involved and they play different roles:
//   punch_events   the immutable trail. Every tap lands here, with whatever
//                  coordinates the browser was willing to give us.
//   attendance_days the ONE resolved row per employee per day that the register
//                  and payroll read. It is never written incrementally — it is
//                  recomputed from the day's events after every punch, so a day
//                  with four punches (in, lunch out, back in, out) totals
//                  correctly instead of losing the first session.
//
// Location is recorded and classified, never enforced: a punch is accepted with
// no coordinates at all (permission denied, no GPS, desktop browser). What the
// geofence decides is only whether the punch is stamped as at-office or
// off-site, for HR to review.
// ============================================================================
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { toCoordinate } from '@/lib/db/money';

const BUSINESS_TZ = 'Asia/Kolkata';

/** Fallback when no radius is configured. The office setting overrides it. */
const DEFAULT_GEOFENCE_M = 50;

export type PunchKind = 'in' | 'out';

/** Browser coordinates, or null when the device would not give them. */
export interface PunchCoords {
  latitude: number;
  longitude: number;
  /** GPS accuracy in metres, if the browser reported it. */
  accuracy?: number | null;
}

export interface PunchStatus {
  status: 'in' | 'out';
  /** ISO timestamp of the most recent punch today, or null if none yet. */
  lastPunchAt: string | null;
  lastKind: PunchKind | null;
  /** true / false / null — null means "not classified" (no coords or no office). */
  lastWithinGeofence: boolean | null;
  /** Where that punch was taken, when the device shared it. Drives the map link. */
  lastLat: number | null;
  lastLng: number | null;
  /** Minutes closed out today. An open session is not counted until punch out. */
  workedMinutes: number;
  /** Whether an office location is configured at all. */
  geofenceConfigured: boolean;
  /** Whether the server will refuse a punch that shares no location. */
  requireLocation: boolean;
}

export interface PunchRecord {
  type: PunchKind;
  timestamp: string;
  withinGeofence: boolean | null;
  /** Coordinates of the punch, or null when the device shared none. */
  lat: number | null;
  lng: number | null;
}

// ------------------------------------------------------------ time helpers --

/** Today's date and wall-clock time in the business timezone, not the server's. */
function localParts(date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
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
 * A safe UTC floor for "events on this local day".
 *
 * punched_at is an instant, so a bare `>= '2026-08-24T00:00:00'` is read as
 * UTC — which in IST (UTC+5:30) is 05:30 local, silently dropping every punch
 * made in the small hours. Going a full day back is offset-agnostic and cheap;
 * the exact local-day filter is then applied in JS with localParts(). Widening
 * the query is safe, narrowing it is not.
 *
 * A Date, NOT an ISO string. The column is a BSON date, and MongoDB orders
 * values within a type — a string bound against a date column is not "before
 * everything", it matches NOTHING, which would have turned every one of these
 * reads into an empty day.
 */
export function dayFloorUtc(date: string): Date {
  const floor = new Date(`${date}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - 1);
  return floor;
}

// -------------------------------------------------------------- geofencing --

/**
 * Great-circle distance in metres. The haversine formula rather than a flat
 * approximation — at a 50m radius the difference is immaterial, but this stays
 * correct if the radius is ever widened to cover a campus.
 */
export function distanceMetres(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** settings.value is jsonb, so a number may arrive as 50 or as "50". */
function numericSetting(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
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
export const LOCATION_REQUIRED =
  'Location is required to punch. Allow location access for this site, then try again.';

export interface PunchPolicy {
  office: OfficeGeofence | null;
  /**
   * Whether a punch is refused when the browser shares NO location at all.
   *
   * This is about whether location is SHARED, not about where the person is —
   * being off-site never blocks a punch. Enforced here on the server, not only
   * in the UI: the route accepts a JSON body, and a client that simply omitted
   * the coordinates would otherwise walk straight past a browser-side check.
   */
  requireLocation: boolean;
}

/** settings.value is jsonb: true, "true" and 'true' all have to mean true. */
function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.replace(/^"|"$/g, '').toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
  }
  return fallback;
}

/** Office point + enforcement policy, read in one round trip. */
export async function readPunchPolicy(): Promise<PunchPolicy> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('settings')
    .select('key, value')
    .in('key', ['office_lat', 'office_lng', 'geofence_radius_m', 'punch_require_location']);
  // Fail CLOSED on a settings read error: defaulting to "location optional"
  // would quietly turn the requirement off the moment the table hiccups.
  if (error) return { office: null, requireLocation: true };

  const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
  const requireLocation = booleanSetting(byKey.get('punch_require_location'), true);

  const latitude = numericSetting(byKey.get('office_lat'));
  const longitude = numericSetting(byKey.get('office_lng'));
  if (latitude == null || longitude == null) return { office: null, requireLocation };

  const radius = numericSetting(byKey.get('geofence_radius_m'));
  return {
    office: {
      latitude,
      longitude,
      radiusM: radius != null && radius > 0 ? radius : DEFAULT_GEOFENCE_M,
    },
    requireLocation,
  };
}

/** The configured office point, or null when it has not been set yet. */
export async function readOfficeGeofence(): Promise<OfficeGeofence | null> {
  return (await readPunchPolicy()).office;
}

/**
 * true inside the fence, false outside, null when we cannot say — no
 * coordinates from the device, or no office configured. null is a real answer
 * and is stored as such; it must not collapse to false, which would read as
 * "this person punched from somewhere else".
 */
function classify(coords: PunchCoords | null, office: OfficeGeofence | null): boolean | null {
  if (!coords || !office) return null;
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

// ----------------------------------------------------------------- context --

async function employeeContext() {
  const { profile } = await getSession();
  if (!profile?.employee_id) throw new Error('Your login is not linked to an employee record.');
  return { profile, employeeId: profile.employee_id };
}

/**
 * A stored coordinate, or null.
 *
 * lat/lng are stored as numbers, but a driver or view that returned them as
 * strings would sail straight into the
 * Google Maps URL and produce a broken link, so the read is narrowed here once
 * rather than guarded at every call site.
 */
function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // String() rather than a typeof test: lat/lng come back as Decimal128, which
  // is neither a number nor a string, so the old form returned null for every
  // stored coordinate and silently dropped the map link.
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function validCoords(coords: PunchCoords | null): PunchCoords | null {
  if (!coords) return null;
  const { latitude, longitude } = coords;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return coords;
}

// ------------------------------------------------------------------ reads --

export async function readPunchStatus(): Promise<PunchStatus> {
  const { employeeId } = await employeeContext();
  const dbc = await createClient();
  const today = localParts().date;

  const [events, policy] = await Promise.all([
    dbc
      .from('punch_events')
      .select<DayEvent[]>('kind, punched_at, within_geofence, lat, lng')
      .eq('employee_id', employeeId)
      .gte('punched_at', dayFloorUtc(today))
      .order('punched_at', { ascending: true }),
    readPunchPolicy(),
  ]);
  if (events.error) throw new Error(events.error.message);

  // Filter in the business timezone: the >= bound above is a coarse cut in UTC,
  // which for IST (UTC+5:30) can drag in the tail of the previous local day.
  const todays = (events.data ?? []).filter(
    (event) => localParts(punchedAt(event)).date === today,
  );
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
  if (error) throw new Error(error.message);
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

// ------------------------------------------------------------------ write --

/**
 * One punch row.
 *
 * Only `kind` and `punched_at` are always selected — sumWorkedMinutes needs
 * nothing else. The location columns are optional because the status query
 * reads them and the session-pairing query does not, and marking them so is
 * what lets one type serve both without a cast.
 */
interface DayEvent {
  kind: string;
  /**
   * A BSON date on the way in and on the way out. Typed loosely because rows
   * carried over from Postgres by a data-only dump can still hold the string
   * form — the collection validator only governs new writes — and every reader
   * here goes through punchedAt() rather than assuming one or the other.
   */
  punched_at: Date | string;
  within_geofence?: boolean | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * The instant a punch row holds, whichever of the two forms it is stored in.
 *
 * Exported because tv.ts reads the same column and used to coerce it its own
 * way; one definition means the board and the employee's own screen cannot
 * disagree about when a punch happened.
 */
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

export interface PunchResult {
  kind: PunchKind;
  punchedAt: string;
  withinGeofence: boolean | null;
  workedMinutes: number;
}

export async function recordPunch(
  kind: PunchKind,
  coords: PunchCoords | null,
): Promise<PunchResult> {
  const { employeeId } = await employeeContext();
  const dbc = await createClient();
  const now = new Date();
  const { date } = localParts(now);

  // --- reject only genuine sequence errors, never a location ---------------
  const { data: priorRaw, error: priorError } = await dbc
    .from('punch_events')
    .select<DayEvent[]>('kind, punched_at')
    .eq('employee_id', employeeId)
    .gte('punched_at', dayFloorUtc(date))
    .order('punched_at', { ascending: true });
  if (priorError) throw new Error(priorError.message);

  const prior = (priorRaw ?? []).filter(
    (event) => localParts(punchedAt(event)).date === date,
  );
  const openNow = prior.length > 0 && prior[prior.length - 1].kind === 'in';

  if (kind === 'in' && openNow) throw new Error('You are already punched in.');
  if (kind === 'out' && !openNow) throw new Error('There is no open punch to close.');

  const point = validCoords(coords);
  const { office, requireLocation } = await readPunchPolicy();

  // Refused for SHARING nothing, never for being somewhere else. Off-site is a
  // stamp, not a veto — see PunchPolicy.requireLocation.
  if (requireLocation && !point) throw new Error(LOCATION_REQUIRED);

  const withinGeofence = classify(point, office);

  const { error: eventError } = await dbc.from('punch_events').insert({
    employee_id: employeeId,
    // The Date itself. punch_events.punched_at is `bsonType: "date"`, so an
    // ISO string was rejected by the collection validator as error 121 — which
    // pgcompat reports as '23514' — and every punch in and punch out failed
    // with "new row violates check constraint".
    punched_at: now,
    kind,
    // numeric(9,6) columns, i.e. `bsonType: "decimal"` — a JS number is
    // serialised as a double and rejected by the validator, so a punch that
    // DID share coordinates failed while one that shared none succeeded.
    // toCoordinate keeps six places; toMoney's two would put the fix about a
    // kilometre out and make the geofence meaningless.
    lat: toCoordinate(point?.latitude ?? null),
    lng: toCoordinate(point?.longitude ?? null),
    within_geofence: withinGeofence,
    source: 'web_app',
  });
  if (eventError) throw new Error(eventError.message);

  const workedMinutes = await resolveDay(employeeId, date, [
    ...prior,
    { kind, punched_at: now },
  ]);

  return { kind, punchedAt: now.toISOString(), withinGeofence, workedMinutes };
}

/**
 * Rewrite today's attendance_days row from the full event trail.
 *
 * The status is deliberately NOT forced to 'P' when a row already exists: HR
 * may have set L, WO, OH, HD or CO for the day, and a punch is not grounds to
 * overwrite that decision. Only 'AB' — nobody showed up — is upgraded, because
 * a punch is direct evidence to the contrary.
 */
async function resolveDay(
  employeeId: string,
  workDate: string,
  events: DayEvent[],
): Promise<number> {
  const dbc = await createClient();

  // 'HH:MM', not localParts()'s 'HH:MM:SS'. attendance_days.punch_in/out are
  // validated against ^[0-9]{2}:[0-9]{2}$ — the shape every other writer uses
  // (the correction form, the nightly sweep, the register import) — and a
  // value with seconds is refused as error 121. This was masked for as long as
  // the upsert failed earlier for a different reason (see repo.upsertFilter);
  // once that was fixed, every employee punch would have failed here instead.
  // Seconds are not lost to the arithmetic: toMinutes() never read them.
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
    },
    { onConflict: 'employee_id,work_date' },
  );
  if (error) throw new Error(error.message);
  return workedMinutes;
}
