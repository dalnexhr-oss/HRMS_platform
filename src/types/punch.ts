type PunchKind = 'in' | 'out';

interface NightSweepNotice {
  workDate: string;
  punchOut: string;
  closedAt: string;
  message: string;
}

interface PunchCoords {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

interface PunchStatus {
  status: PunchKind;
  lastPunchAt: string | null;
  lastKind: PunchKind | null;
  /** Null when coordinates or an office location were unavailable. */
  lastWithinGeofence: boolean | null;
  lastLat: number | null;
  lastLng: number | null;
  /** Total for completed sessions today; excludes the active session. */
  workedMinutes: number;
  geofenceConfigured: boolean;
  requireLocation: boolean;
  lastNightSweep: NightSweepNotice | null;
}

interface PunchRecord {
  type: PunchKind;
  timestamp: string;
  withinGeofence: boolean | null;
  lat: number | null;
  lng: number | null;
}

interface PunchResult {
  kind: PunchKind;
  punchedAt: string;
  withinGeofence: boolean | null;
  workedMinutes: number;
}

export type { PunchKind, NightSweepNotice, PunchCoords, PunchStatus, PunchRecord, PunchResult };
