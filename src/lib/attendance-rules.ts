// Shared auto punch-out rules for register imports and attendance sweeps. Read the configured
// closing time so missing punch-outs do not leave worked minutes at zero.
import { createClient } from '@/lib/db/server';
import { isMongoConfigured } from '@/lib/db/mongo';

export const defaultPunchOutMin = 18 * 60;

const minutesPerDay = 1440;

// 'HH:MM' (or 'HH:MM:SS') -> minutes since midnight, or null.
export function clockToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) && mins >= 0 && mins < minutesPerDay ? mins : null;
}

// minutes since midnight -> 'HH:MM'.
export function minutesToClock(mins: number): string {
  const m = ((Math.round(mins) % minutesPerDay) + minutesPerDay) % minutesPerDay;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Parse auto_punch_out_time as minutes since midnight. Accept bare or JSON-quoted time strings; use
 * the shared fallback for missing or malformed settings.
 */
export function autoPunchOutMinutesFrom(value: unknown): number {
  const raw = typeof value === 'string' ? value.trim().replace(/^"(.*)"$/, '$1') : value;
  return clockToMinutes(raw) ?? defaultPunchOutMin;
}

/**
 * The configured auto punch-out time in minutes, read through the caller's own
 * session. Falls back to 18:00 when the setting is missing, unreadable or
 * unparseable.
 */
export async function getAutoPunchOutMinutes(): Promise<number> {
  if (!isMongoConfigured()) return defaultPunchOutMin;
  try {
    const dbc = await createClient();
    const { data, error } = await dbc
      .from('settings')
      .select('value')
      .eq('key', 'auto_punch_out_time')
      .maybeSingle<{ value: unknown }>();
    if (error || !data) return defaultPunchOutMin;
    return autoPunchOutMinutesFrom(data.value);
  } catch {
    return defaultPunchOutMin;
  }
}

export interface ClosedDay {
  outMin: number;
  workedMin: number;
  /** True when this day was closed automatically rather than by a real punch. */
  autoClosed: boolean;
}

/**
 * Close a day that has a punch-in but no punch-out.
 *
 * Returns null when nothing needs doing (no punch-in, or already punched out).
 * The worked span is out−in, guarding the case where the configured close time
 * is earlier than the punch-in (a night shift) by wrapping a day.
 */
export function autoCloseDay(
  inMin: number | null,
  outMin: number | null,
  autoOutMin: number,
): ClosedDay | null {
  if (inMin === null || outMin !== null) return null;
  const span = autoOutMin >= inMin ? autoOutMin - inMin : autoOutMin + minutesPerDay - inMin;
  return { outMin: autoOutMin, workedMin: Math.max(0, span), autoClosed: true };
}
