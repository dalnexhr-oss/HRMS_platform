// ============================================================================
// Shared attendance rules. SERVER ONLY (reads the settings table).
//
// Auto punch-out: when an employee punches in but never punches out, the day is
// closed at a configured time (default 18:00) rather than left open — an open
// day otherwise reads as zero worked minutes and silently inflates the payroll
// hours-shortfall deduction. Applied in BOTH directions:
//   * the register import (uploaded sheets with a blank Out cell), and
//   * the night sweep (live punches left open).
// ============================================================================
import { createClient } from '@/lib/db/server';
import { isMongoConfigured } from '@/lib/db/mongo';

/** 18:00 in minutes since midnight — the documented default. */
export const AUTO_PUNCH_OUT_DEFAULT_MIN = 18 * 60;

const MINUTES_PER_DAY = 1440;

/** 'HH:MM' (or 'HH:MM:SS') -> minutes since midnight, or null. */
export function clockToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) && mins >= 0 && mins < MINUTES_PER_DAY ? mins : null;
}

/** minutes since midnight -> 'HH:MM'. */
export function minutesToClock(mins: number): string {
  const m = ((Math.round(mins) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * A stored `auto_punch_out_time` setting as minutes since midnight.
 *
 * Pure, and the ONE place the fallback lives. db/scheduler.ts had its own copy
 * of this decision that defaulted to '19:00' instead: on a deployment where the
 * settings row was never seeded, a day closed by the manual sweep got 18:00 and
 * the same day closed by /api/cron got 19:00 — sixty phantom worked minutes on
 * the register and in the payslip, depending on which path happened to fire.
 *
 * A setting can be stored either bare ('18:00') or JSON-quoted ('"18:00"'), so
 * one layer of quotes is stripped. Anything else — a number, an object, a
 * malformed string — falls back rather than becoming NaN, which would otherwise
 * be written straight into worked_minutes.
 */
export function autoPunchOutMinutesFrom(value: unknown): number {
  const raw = typeof value === 'string' ? value.trim().replace(/^"(.*)"$/, '$1') : value;
  return clockToMinutes(raw) ?? AUTO_PUNCH_OUT_DEFAULT_MIN;
}

/**
 * The configured auto punch-out time in minutes, read through the caller's own
 * session. Falls back to 18:00 when the setting is missing, unreadable or
 * unparseable.
 */
export async function getAutoPunchOutMinutes(): Promise<number> {
  if (!isMongoConfigured()) return AUTO_PUNCH_OUT_DEFAULT_MIN;
  try {
    const dbc = await createClient();
    const { data, error } = await dbc
      .from('settings')
      .select('value')
      .eq('key', 'auto_punch_out_time')
      .maybeSingle<{ value: unknown }>();
    if (error || !data) return AUTO_PUNCH_OUT_DEFAULT_MIN;
    return autoPunchOutMinutesFrom(data.value);
  } catch {
    return AUTO_PUNCH_OUT_DEFAULT_MIN;
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
  const span = autoOutMin >= inMin ? autoOutMin - inMin : autoOutMin + MINUTES_PER_DAY - inMin;
  return { outMin: autoOutMin, workedMin: Math.max(0, span), autoClosed: true };
}
