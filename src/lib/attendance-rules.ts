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
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

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
 * The configured auto punch-out time in minutes. Falls back to 18:00 when the
 * setting is missing, unparseable, or Supabase isn't configured.
 */
export async function getAutoPunchOutMinutes(): Promise<number> {
  if (!isSupabaseConfigured()) return AUTO_PUNCH_OUT_DEFAULT_MIN;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'auto_punch_out_time')
      .maybeSingle<{ value: unknown }>();
    if (error || !data) return AUTO_PUNCH_OUT_DEFAULT_MIN;
    return clockToMinutes(data.value) ?? AUTO_PUNCH_OUT_DEFAULT_MIN;
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
