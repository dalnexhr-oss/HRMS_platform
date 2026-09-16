import { todayIST } from '@/lib/format';
import type { NightSweepNotice } from '@/types/punch';

export interface SweepClosure {
  work_date: string;
  punch_in: string | null;
  punch_out: string | null;
  auto_close_source?: 'scheduled' | 'manual' | null;
  auto_closed_at?: Date | string | null;
}

export function previousWorkDate(date: string): string {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

/** Missing punches alone are not evidence that the scheduled sweep ran. */
export function lastNightSweepNotice(
  day: SweepClosure | null,
  now = new Date(),
): NightSweepNotice | null {
  if (
    !day ||
    day.auto_close_source !== 'scheduled' ||
    !day.auto_closed_at ||
    !day.punch_in ||
    !day.punch_out ||
    day.work_date !== previousWorkDate(todayIST(now))
  ) {
    return null;
  }
  const closedAt = new Date(day.auto_closed_at);
  if (
    !Number.isFinite(closedAt.getTime()) ||
    closedAt > now ||
    todayIST(closedAt) !== todayIST(now)
  ) {
    return null;
  }
  return {
    workDate: day.work_date,
    punchOut: day.punch_out,
    closedAt: closedAt.toISOString(),
    message: `You missed your punch-out on ${day.work_date}. Last night’s automatic sweep closed your attendance at ${day.punch_out} IST. Contact HR if this time needs correcting.`,
  };
}
