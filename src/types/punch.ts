export type PunchKind = 'in' | 'out';

export interface NightSweepNotice {
  workDate: string;
  punchOut: string;
  closedAt: string;
  message: string;
}

export interface PunchCoords {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export interface PunchStatus {
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

export interface PunchRecord {
  type: PunchKind;
  timestamp: string;
  withinGeofence: boolean | null;
  lat: number | null;
  lng: number | null;
}

export interface PunchResult {
  kind: PunchKind;
  punchedAt: string;
  withinGeofence: boolean | null;
  workedMinutes: number;
}
