// Shared display formatting and IST business dates.

// Today as YYYY-MM-DD in IST. UTC is still the previous day before 05:30 IST, so business-date
// defaults must use this helper.
export function todayIST(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

// The current calendar year in IST.
export function currentYearIST(): number {
  return Number(todayIST().slice(0, 4));
}

// ₹1,23,456 — Indian-grouped rupees, rounded.
export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// minutes -> 'HH:MM' (e.g. 560 -> '09:20').
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'HH:MM' or 'HH:MM:SS' time string -> minutes since midnight. */
export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/** '2022-07-15' -> '15 Jul 2022'. */
export function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Formats time string to 'HH:MM' (e.g. '09:20:00' -> '09:20'). */
export function trimTime(t: string | null): string | null {
  if (!t) {
    return null;
  }
  return t.slice(0, 5);
}

// Period months use YYYY-MM-01 across payroll, register URLs, and import cell B2. Keep these pure
// helpers client-safe.

/**
 * Format YYYY-MM-01 as a month label using UTC for both parsing and display. This matches the
 * workbook date and avoids showing the previous month west of UTC.
 */
export function monthLabelUTC(periodMonth: string): string {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return periodMonth;
  }
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Return period months newest first: ahead future months, the current month, then back previous
 * months. Date.UTC handles year boundaries.
 */
export function monthOptionsAround(currentMonth: string, back = 12, ahead = 1): string[] {
  const year = Number(currentMonth.slice(0, 4));
  const month1 = Number(currentMonth.slice(5, 7));
  const out: string[] = [];
  for (let delta = ahead; delta >= -back; delta--) {
    const d = new Date(Date.UTC(year, month1 - 1 + delta, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}
